// BlastSimulator2026 — Ground markers over active traffic jams (#1208)
// One marker per jam key: a pulsing ring on the ground with a warning label
// floating above it. Mirrors RampArrowLayer: sync() reconciles idempotently
// (add / move / remove), dispose() removes everything.

import * as THREE from 'three';
import { t } from '../core/i18n/I18n.js';
import type { TrafficJam } from '../core/events/TrafficJams.js';
import { markSceneOverlay } from './post/SceneOverlay.js';
import type { SurfaceHeightSampler } from './GroundTint.js';

const RING_COLOR = 0xff8c1a;
const RING_INNER = 1.1;
const RING_OUTER = 1.6;
const Y_OFFSET = 0.15;
const LABEL_HEIGHT = 2.6;
const LABEL_SIZE = { w: 2.4, h: 0.9 };
const PULSE_PERIOD_MS = 900;
const PULSE_AMPLITUDE = 0.18;
const RENDER_ORDER = 21;
const CANVAS_W = 128;
const CANVAS_H = 48;

interface JamMarker {
  group: THREE.Group;
  ring: THREE.Mesh;
  label: THREE.Mesh;
  texture: THREE.CanvasTexture | null;
}

/** Builds the warning-glyph label material; a flat colour where no 2D canvas exists (Node-only tests). */
function buildLabelMaterial(): { material: THREE.MeshBasicMaterial; texture: THREE.CanvasTexture | null } {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.fillStyle = 'rgba(26,20,8,0.85)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#ffb02e';
      ctx.font = `bold ${Math.round(CANVAS_H * 0.6)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚠ ${t('ui.marker.traffic_jam')}`, CANVAS_W / 2, CANVAS_H / 2 + 1);
      const texture = new THREE.CanvasTexture(canvas);
      return { material: new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, side: THREE.DoubleSide }), texture };
    }
  }
  return { material: new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, depthTest: false, side: THREE.DoubleSide }), texture: null };
}

export class TrafficJamMarkerLayer {
  private readonly scene: THREE.Scene;
  private readonly surfaceY: SurfaceHeightSampler;
  private readonly markers = new Map<string, JamMarker>();
  /** Tick the markers were last reconciled for; lets the caller compute jams once per tick. */
  syncedTick = -1;

  constructor(scene: THREE.Scene, surfaceY: SurfaceHeightSampler) {
    this.scene = scene;
    this.surfaceY = surfaceY;
  }

  sync(jams: readonly TrafficJam[]): void {
    const keep = new Set(jams.map(j => j.key));
    for (const [key, marker] of this.markers) {
      if (!keep.has(key)) this.remove(key, marker);
    }
    for (const jam of jams) {
      let marker = this.markers.get(jam.key);
      if (!marker) {
        marker = this.build();
        this.scene.add(marker.group);
        this.markers.set(jam.key, marker);
      }
      marker.group.position.set(jam.x, this.surfaceY(jam.x, jam.z) + Y_OFFSET, jam.z);
    }
  }

  /** Number of jam markers currently drawn. */
  get count(): number {
    return this.markers.size;
  }

  dispose(): void {
    for (const [key, marker] of this.markers) this.remove(key, marker);
  }

  private build(): JamMarker {
    const group = new THREE.Group();
    group.name = 'traffic-jam-marker';
    markSceneOverlay(group);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(RING_INNER, RING_OUTER, 32),
      new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = RENDER_ORDER;
    ring.onBeforeRender = () => {
      const phase = (performance.now() % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
      ring.scale.setScalar(1 + PULSE_AMPLITUDE * Math.sin(phase * Math.PI * 2));
    };

    const { material, texture } = buildLabelMaterial();
    const label = new THREE.Mesh(new THREE.PlaneGeometry(LABEL_SIZE.w, LABEL_SIZE.h), material);
    label.position.y = LABEL_HEIGHT;
    label.renderOrder = RENDER_ORDER + 1;

    group.add(ring, label);
    return { group, ring, label, texture };
  }

  private remove(key: string, marker: JamMarker): void {
    this.scene.remove(marker.group);
    for (const mesh of [marker.ring, marker.label]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    marker.texture?.dispose();
    this.markers.delete(key);
  }
}

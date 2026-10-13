// @vitest-environment jsdom
// BlastSimulator2026 — Sound lab panel
// Built in jsdom against a recording player: every catalog entry has its control,
// and each control asks the player for what it says.

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SOUND_CATALOG } from '../../../../src/audio/SoundCatalog.js';
import { groupCatalogByBus, describeSound, sourcePosition } from '../../../../src/audio/lab/catalogView.js';
import type { AssetReport, MixReport } from '../../../../src/audio/lab/labReport.js';
import { MIX_SCENARIO_NAMES } from '../../../../src/audio/lab/mixTypes.js';
import { slider } from '../../../../src/audio/lab/panel/dom.js';
import type { LabControls } from '../../../../src/audio/lab/panel/labControls.js';
import { mountLabPanel } from '../../../../src/audio/lab/panel/labPanel.js';
import { formatStatus, type LabStatus } from '../../../../src/audio/lab/panel/labStatus.js';
import { LAB_PANEL_CONFIG, LAB_RENDER_CONFIG } from '../../../../src/core/config/audio/lab.js';
import { RecordingPlayer } from '../../../helpers/audioPlayerFakes.js';

const STATUS: LabStatus = { contextState: 'running', ready: true, voices: 2, peakVoices: 5, loaded: 90, expected: 90, failed: [] };

interface Rig {
  readonly recorder: RecordingPlayer;
  readonly controls: LabControls;
  readonly root: HTMLElement;
  readonly calls: { blast: Mock<[], void>; busy: Mock<[], boolean>; stop: Mock<[], void>; volumes: Array<[string, number]> };
  status: LabStatus;
  assets: AssetReport;
  mix: Promise<MixReport>;
  refresh(): void;
}

function rig(): Rig {
  const recorder = new RecordingPlayer();
  const calls = { blast: vi.fn<[], void>(), busy: vi.fn<[], boolean>(() => true), stop: vi.fn<[], void>(), volumes: [] as Array<[string, number]> };
  const state = { status: STATUS, assets: { loaded: [], failed: [] } as AssetReport, mix: Promise.resolve({} as MixReport) };
  const controls: LabControls = {
    player: recorder,
    getVolume: channel => (channel === 'master' ? 1 : 0.7),
    setVolume: (channel, value) => { calls.volumes.push([channel, value]); },
    status: () => state.status,
    assets: () => state.assets,
    playBlast: calls.blast,
    toggleBusyMine: calls.busy,
    stopAll: calls.stop,
    downloadMix: () => state.mix,
  };
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const panel = mountLabPanel(root, controls);
  return {
    recorder, controls, root, calls,
    get status() { return state.status; }, set status(v) { state.status = v; },
    get assets() { return state.assets; }, set assets(v) { state.assets = v; },
    get mix() { return state.mix; }, set mix(v) { state.mix = v; },
    refresh: () => { panel.refreshStatus(); },
  };
}

const row = (root: HTMLElement, id: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(`[data-sound="${id}"]`);
  if (!found) throw new Error(`no row for ${id}`);
  return found;
};
const click = (element: Element | null): void => { (element as HTMLElement).click(); };
const setSlider = (input: HTMLInputElement, value: number): void => {
  input.value = String(value);
  input.dispatchEvent(new Event('input'));
};

let t: Rig;
beforeEach(() => { t = rig(); });

describe('the catalog on the page', () => {
  it('has a row for every catalog entry, under the bus it plays on', () => {
    for (const section of groupCatalogByBus()) {
      const busEl = t.root.querySelector(`[data-bus="${section.bus}"]`);
      expect(busEl).not.toBeNull();
      for (const entry of [...section.oneShots, ...section.loops]) expect(busEl?.querySelector(`[data-sound="${entry.id}"]`), entry.id).not.toBeNull();
    }
    expect(t.root.querySelectorAll('[data-sound]')).toHaveLength(Object.keys(SOUND_CATALOG).length);
  });

  it('gives one-shots a Play button and beds a toggle', () => {
    expect(row(t.root, 'ui_click').querySelector('[data-action=play]')).not.toBeNull();
    expect(row(t.root, 'ui_click').querySelector('[data-action=toggle]')).toBeNull();
    expect(row(t.root, 'amb_wind').querySelector('[data-action=toggle]')).not.toBeNull();
    expect(row(t.root, 'amb_wind').querySelector('[data-action=play]')).toBeNull();
  });

  it('only offers distance and direction for positional sounds', () => {
    expect(row(t.root, 'work_drill').querySelector('[data-role=distance]')).not.toBeNull();
    expect(row(t.root, 'work_drill').querySelector('[data-role=side]')).not.toBeNull();
    expect(row(t.root, 'ui_click').querySelector('[data-role=distance]')).toBeNull();
  });

  it('describes where a sound comes from', () => {
    expect(describeSound(SOUND_CATALOG.ui_click)).toBe('2 samples · -6 dB · priority 2');
    expect(describeSound(SOUND_CATALOG.ui_hover)).toContain('sample · -10.5 dB');
    expect(describeSound(SOUND_CATALOG.blast_boom)).toContain('+2 dB');
    expect(describeSound(SOUND_CATALOG.blast_sub)).toContain('synth blast_sub');
  });
});

describe('one-shot rows', () => {
  it('plays a plain sound with no options', () => {
    click(row(t.root, 'ui_click').querySelector('[data-action=play]'));
    expect(t.recorder.calls).toEqual([{ id: 'ui_click', opts: undefined }]);
    expect(row(t.root, 'ui_click').querySelector('[data-role=result]')?.textContent).toBe('played');
  });

  it('plays a positional sound at the chosen distance, straight ahead by default', () => {
    click(row(t.root, 'work_drill').querySelector('[data-action=play]'));
    const at = t.recorder.plays[0]?.opts?.at;
    expect(at?.x).toBeCloseTo(0, 6);
    expect(at?.z).toBeCloseTo(-LAB_PANEL_CONFIG.distance.defaultM, 6);
  });

  it('moves the source with the sliders', () => {
    const drill = row(t.root, 'work_drill');
    setSlider(drill.querySelector<HTMLInputElement>('[data-role=distance]')!, 60);
    setSlider(drill.querySelector<HTMLInputElement>('[data-role=side]')!, 1);
    click(drill.querySelector('[data-action=play]'));
    const at = t.recorder.plays[0]?.opts?.at;
    expect(at?.x).toBeCloseTo(60, 6);
    expect(at?.z).toBeCloseTo(0, 6);
    setSlider(drill.querySelector<HTMLInputElement>('[data-role=side]')!, -1);
    click(drill.querySelector('[data-action=play]'));
    expect(t.recorder.plays[1]?.opts?.at?.x).toBeCloseTo(-60, 6);
    expect(drill.textContent).toContain('60 m');
  });

  it('says so when the player drops the sound', () => {
    t.recorder.refuse.add('ui_click');
    const target = row(t.root, 'ui_click');
    click(target.querySelector('[data-action=play]'));
    const result = target.querySelector('[data-role=result]');
    expect(result?.textContent).toContain('dropped');
    expect(result?.classList.contains('dropped')).toBe(true);
    t.recorder.refuse.clear();
    click(target.querySelector('[data-action=play]'));
    expect(result?.classList.contains('dropped')).toBe(false);
  });
});

describe('bed rows', () => {
  it('switches a bed on at the slider level and off again', () => {
    const wind = row(t.root, 'amb_wind');
    const toggle = wind.querySelector('[data-action=toggle]')!;
    expect(toggle.textContent).toBe('Off');
    click(toggle);
    expect(t.recorder.bed('amb_wind').calls).toEqual([{ level: LAB_PANEL_CONFIG.loopLevel.default, rampS: LAB_PANEL_CONFIG.loopLevel.rampS }]);
    expect(toggle.textContent).toBe('On');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    click(toggle);
    expect(t.recorder.lastLevel('amb_wind')).toBe(0);
    expect(toggle.textContent).toBe('Off');
  });

  it('follows the level slider only while the bed is on', () => {
    const wind = row(t.root, 'amb_wind');
    const level = wind.querySelector<HTMLInputElement>('[data-role=level]')!;
    setSlider(level, 0.9);
    expect(t.recorder.loops.has('amb_wind')).toBe(false);
    click(wind.querySelector('[data-action=toggle]'));
    expect(t.recorder.lastLevel('amb_wind')).toBe(0.9);
    setSlider(level, 0.2);
    expect(t.recorder.lastLevel('amb_wind')).toBe(0.2);
  });
});

describe('volumes and listener', () => {
  it('starts the sliders at the current volumes and reports every move', () => {
    const master = t.root.querySelector<HTMLInputElement>('[data-channel=master]')!;
    const ambient = t.root.querySelector<HTMLInputElement>('[data-channel=ambient]')!;
    expect(master.value).toBe('1');
    expect(ambient.value).toBe('0.7');
    setSlider(ambient, 0.25);
    setSlider(master, 0.5);
    expect(t.calls.volumes).toEqual([['ambient', 0.25], ['master', 0.5]]);
    expect(t.root.querySelector('[data-section=volumes]')?.textContent).toContain('25%');
  });

  it('places the listener at the origin on mount and follows the camera distance slider', () => {
    expect(t.recorder.listeners).toEqual([{ ...LAB_RENDER_CONFIG.listener, viewDistance: LAB_PANEL_CONFIG.viewDistance.defaultM }]);
    setSlider(t.root.querySelector<HTMLInputElement>('[data-role=view-distance]')!, 90);
    expect(t.recorder.listeners.at(-1)).toMatchObject({ x: 0, z: 0, rightX: 1, rightZ: 0, viewDistance: 90 });
  });
});

describe('scenarios', () => {
  it('starts the blast', () => {
    click(t.root.querySelector('[data-action=blast]'));
    expect(t.calls.blast).toHaveBeenCalledTimes(1);
  });

  it('toggles the busy mine and shows whether it runs', () => {
    const busy = t.root.querySelector('[data-action=busy-mine]')!;
    click(busy);
    expect(t.calls.busy).toHaveBeenCalledTimes(1);
    expect(busy.getAttribute('aria-pressed')).toBe('true');
    t.calls.busy.mockReturnValueOnce(false);
    click(busy);
    expect(busy.getAttribute('aria-pressed')).toBe('false');
  });

  it('stops everything and switches every bed toggle off', () => {
    click(row(t.root, 'amb_wind').querySelector('[data-action=toggle]'));
    click(t.root.querySelector('[data-action=busy-mine]'));
    click(t.root.querySelector('[data-action=stop-all]'));
    expect(t.calls.stop).toHaveBeenCalledTimes(1);
    expect(row(t.root, 'amb_wind').querySelector('[data-action=toggle]')?.textContent).toBe('Off');
    expect(t.root.querySelector('[data-action=busy-mine]')?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('offline mix download', () => {
  const report = { name: 'blast', stats: { durationS: 26, peakDbfs: -3, gatedRmsDbfs: -24, crestFactorDb: 21, integratedLufs: -26, shortTermMaxLufs: -22, clipCount: 0, dcOffset: 0, monoLossDb: 0 }, requested: 5, dropped: 0, peakVoices: 3 } as unknown as MixReport;

  it('offers every scenario', () => {
    const options = [...t.root.querySelectorAll('[data-role=mix-scenario] option')].map(o => o.getAttribute('value'));
    expect(options).toEqual([...MIX_SCENARIO_NAMES]);
  });

  it('renders the chosen scenario and prints its measurements', async () => {
    const downloadMix = vi.spyOn(t.controls, 'downloadMix').mockResolvedValue(report);
    const select = t.root.querySelector<HTMLSelectElement>('[data-role=mix-scenario]')!;
    select.value = 'blast';
    const button = t.root.querySelector<HTMLButtonElement>('[data-action=download-mix]')!;
    click(button);
    expect(downloadMix).toHaveBeenCalledWith('blast');
    expect(button.disabled).toBe(true);
    expect(t.root.querySelector('[data-role=mix-output]')?.textContent).toContain('rendering blast');
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(t.root.querySelector('[data-role=mix-output]')?.textContent).toContain('peak dBFS');
  });

  it('shows why a render failed and lets the player try again', async () => {
    vi.spyOn(t.controls, 'downloadMix').mockRejectedValue(new Error('no offline context'));
    const button = t.root.querySelector<HTMLButtonElement>('[data-action=download-mix]')!;
    click(button);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(t.root.querySelector('[data-role=mix-output]')?.textContent).toBe('render failed: no offline context');
  });
});

describe('status and asset report', () => {
  it('prints the status line and marks trouble', () => {
    const status = t.root.querySelector('[data-role=status]')!;
    expect(status.textContent).toBe('context: running · engine: ready · voices: 2 (peak 5) · 90/90 assets loaded');
    expect(status.classList.contains('bad')).toBe(false);
    t.status = { ...STATUS, contextState: 'suspended', failed: ['sample:x (boom)'] };
    t.refresh();
    expect(status.textContent).toContain('context: suspended');
    expect(status.textContent).toContain('1 FAILED');
    expect(status.classList.contains('bad')).toBe(true);
  });

  it('lists loaded and failed assets, redrawing only when they change', () => {
    t.assets = { loaded: [{ name: 'ui_click_1', kind: 'sample', durationS: 0.13, peakDbfs: -1 }], failed: ['recipe:thunder (boom)'] };
    t.refresh();
    const section = t.root.querySelector('[data-section=assets]')!;
    expect(section.querySelector('summary')?.textContent).toBe('Assets: 1 loaded, 1 failed');
    expect(section.querySelector('[data-role=failed]')?.textContent).toContain('recipe:thunder (boom)');
    expect(section.textContent).toContain('ui_click_1');
    t.refresh();
    expect(t.root.querySelector('[data-section=assets]')).toBe(section);
  });

  it('says when nothing failed', () => {
    expect(t.root.querySelector('[data-section=assets] .ok')?.textContent).toBe('No asset failed.');
  });

  it('formats the status line without failures', () => {
    expect(formatStatus({ ...STATUS, ready: false, contextState: 'suspended', loaded: 3 })).toBe('context: suspended · engine: loading · voices: 2 (peak 5) · 3/90 assets loaded');
  });
});

describe('sourcePosition', () => {
  it('puts the source ahead at side 0, to the right at 1, to the left at -1', () => {
    expect(sourcePosition(10, 0).z).toBeCloseTo(-10, 6);
    expect(sourcePosition(10, 1).x).toBeCloseTo(10, 6);
    expect(sourcePosition(10, -1).x).toBeCloseTo(-10, 6);
  });

  it('keeps the distance and clamps the side', () => {
    const p = sourcePosition(40, 0.4);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(40, 6);
    expect(sourcePosition(10, 5).x).toBeCloseTo(10, 6);
  });
});

describe('slider helper', () => {
  it('shows the formatted value and reports numbers', () => {
    const seen: number[] = [];
    const handle = slider({ label: 'x', min: 0, max: 10, step: 1, value: 3, format: v => `${v} units`, onInput: v => seen.push(v) });
    expect(handle.element.textContent).toContain('3 units');
    setSlider(handle.input, 7);
    expect(seen).toEqual([7]);
    expect(handle.value()).toBe(7);
    expect(handle.element.textContent).toContain('7 units');
  });
});

// BlastSimulator2026 — Sound lab panel
// The control surface of the sound lab page: volumes, the listener, the scripted
// scenarios, the offline mix download, every sound of the catalog by bus, and the
// asset report. Plain DOM; the audio lives behind `LabControls`.

import type { VolumeChannel } from '../../AudioManager.js';
import type { SoundBus } from '../../SoundCatalog.js';
import { LAB_PANEL_CONFIG, LAB_RENDER_CONFIG } from '../../../core/config/audio/lab.js';
import { groupCatalogByBus } from '../catalogView.js';
import { formatMixTable } from '../formatReport.js';
import type { AssetReport } from '../labReport.js';
import { MIX_SCENARIO_NAMES, type MixScenarioName } from '../mixTypes.js';
import { button, h, slider } from './dom.js';
import type { LabControls } from './labControls.js';
import { formatStatus } from './labStatus.js';
import { loopRow, oneShotRow, type LoopRow } from './soundRows.js';

const VOLUME_CHANNELS: ReadonlyArray<readonly [VolumeChannel, string]> = [
  ['master', 'Master'], ['ui', 'Interface bus'], ['effects', 'Effects bus'], ['ambient', 'Ambient bus'],
];

const BUS_TITLES: Readonly<Record<SoundBus, string>> = { ui: 'Interface', effects: 'Effects', ambient: 'Ambient' };

interface LabPanel {
  /** Redraw the status line (call on a timer). */
  refreshStatus(): void;
}

function volumeSection(lab: LabControls): HTMLElement {
  return h('section', { class: 'panel', 'data-section': 'volumes' },
    h('h2', {}, 'Volumes'),
    ...VOLUME_CHANNELS.map(([channel, label]) => slider({
      label, min: 0, max: 1, step: 0.01, value: lab.getVolume(channel), format: v => `${Math.round(v * 100)}%`,
      onInput: (v) => { lab.setVolume(channel, v); }, attrs: { 'data-channel': channel },
    }).element));
}

function listenerSection(lab: LabControls): HTMLElement {
  const view = LAB_PANEL_CONFIG.viewDistance;
  const place = (viewDistance: number): void => { lab.player.setListener({ ...LAB_RENDER_CONFIG.listener, viewDistance }); };
  place(view.defaultM);
  return h('section', { class: 'panel', 'data-section': 'listener' },
    h('h2', {}, 'Listener'),
    h('p', { class: 'hint' }, 'Sits at the origin. A farther camera hears a wider neighbourhood: positional sounds keep full level out to 0.6 x this distance.'),
    slider({ label: 'camera distance', min: view.minM, max: view.maxM, step: view.stepM, value: view.defaultM, format: v => `${v} m`, onInput: place, attrs: { 'data-role': 'view-distance' } }).element);
}

function scenarioSection(lab: LabControls, loops: LoopRow[]): HTMLElement {
  const busy = button('Busy mine (20 s)', () => {
    busy.setAttribute('aria-pressed', String(lab.toggleBusyMine()));
  }, { 'data-action': 'busy-mine', 'aria-pressed': 'false' });
  const stop = button('Stop all', () => {
    lab.stopAll();
    busy.setAttribute('aria-pressed', 'false');
    for (const row of loops) row.reset();
  }, { 'data-action': 'stop-all' });
  return h('section', { class: 'panel', 'data-section': 'scenarios' },
    h('h2', {}, 'Scenarios'),
    h('p', { class: 'hint' }, 'Blast: heavy rain, the siren and its beeps, then a synthetic round planned by the game\'s own blast planner, with the ambience ducked (about 26 s). Busy mine: work bursts, hauls, backup alarms and horns over the diesel bed.'),
    h('div', { class: 'buttons' }, button('Blast', () => { lab.playBlast(); }, { 'data-action': 'blast' }), busy, stop));
}

function mixSection(lab: LabControls): HTMLElement {
  const select = h('select', { 'data-role': 'mix-scenario' }, ...MIX_SCENARIO_NAMES.map(name => h('option', { value: name }, name)));
  const output = h('pre', { class: 'mix-output', 'data-role': 'mix-output' });
  const download = button('Download mix WAV', () => {
    const name = select.value as MixScenarioName;
    download.disabled = true;
    output.textContent = `rendering ${name} offline...`;
    lab.downloadMix(name)
      .then((report) => { output.textContent = formatMixTable([report]); })
      .catch((error: unknown) => { output.textContent = `render failed: ${error instanceof Error ? error.message : String(error)}`; })
      .finally(() => { download.disabled = false; });
  }, { 'data-action': 'download-mix' });
  return h('section', { class: 'panel', 'data-section': 'mix' },
    h('h2', {}, 'Offline mix'),
    h('p', { class: 'hint' }, 'Renders a scenario through the real graph (buses, limiter, reverb, ducking) faster than real time, measures it and downloads a stereo 16-bit WAV.'),
    h('div', { class: 'buttons' }, select, download), output);
}

function assetSection(report: AssetReport): HTMLElement {
  const failed = report.failed.length > 0
    ? h('ul', { class: 'failed', 'data-role': 'failed' }, ...report.failed.map(text => h('li', {}, text)))
    : h('p', { class: 'ok' }, 'No asset failed.');
  const rows = report.loaded.map(asset => h('tr', {},
    h('td', {}, asset.name), h('td', {}, asset.kind), h('td', {}, `${asset.durationS.toFixed(2)} s`), h('td', {}, `${asset.peakDbfs.toFixed(1)} dBFS`)));
  return h('details', { class: 'panel', 'data-section': 'assets' },
    h('summary', {}, `Assets: ${report.loaded.length} loaded, ${report.failed.length} failed`),
    failed,
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'asset'), h('th', {}, 'kind'), h('th', {}, 'length'), h('th', {}, 'peak'))), h('tbody', {}, ...rows)));
}

export function mountLabPanel(root: HTMLElement, lab: LabControls): LabPanel {
  const status = h('p', { class: 'status', 'data-role': 'status' });
  const loops: LoopRow[] = [];
  const busSections = groupCatalogByBus().map((section) => {
    const loopRows = section.loops.map(entry => loopRow(entry, lab.player));
    loops.push(...loopRows);
    return h('section', { class: 'panel bus', 'data-bus': section.bus },
      h('h2', {}, `${BUS_TITLES[section.bus]} bus`),
      ...section.oneShots.map(entry => oneShotRow(entry, lab.player)),
      ...loopRows.map(row => row.element));
  });
  const assets = h('div', { 'data-role': 'assets' });
  const refreshStatus = (): void => {
    const current = lab.status();
    status.textContent = formatStatus(current);
    status.classList.toggle('bad', current.failed.length > 0 || current.contextState !== 'running');
    const report = lab.assets();
    const key = `${report.loaded.length}/${report.failed.length}`;
    if (assets.dataset.key !== key) {
      assets.dataset.key = key;
      assets.replaceChildren(assetSection(report));
    }
  };
  root.replaceChildren(
    h('h1', {}, 'Sound lab'),
    status,
    h('div', { class: 'grid' }, volumeSection(lab), listenerSection(lab), scenarioSection(lab, loops), mixSection(lab)),
    assets,
    ...busSections);
  refreshStatus();
  return { refreshStatus };
}

// BlastSimulator2026 — Sound lab (dev page)
// A control panel to audition and tune every sound of the game through the real
// audio engine, plus the automated check behind `npm run sounds:check`
// (?autotest=1): it loads every asset, tests the live context, renders the lab's
// mix scenarios offline through the real graph and measures them.
// Served by Vite as /sound-lab.html; driven by scripts/sound-lab-check.ts.

import { Random } from './core/math/Random.js';
import { LAB_PANEL_CONFIG, LAB_RENDER_CONFIG } from './core/config/audio/lab.js';
import { AudioEngine, fetchArrayBuffer, type AudioEngineOptions } from './audio/AudioEngine.js';
import { AudioManager } from './audio/AudioManager.js';
import { SOUND_CATALOG } from './audio/SoundCatalog.js';
import { planPreload } from './audio/engine/preloadPlan.js';
import { SYNTH_RECIPES, renderReverbIr } from './audio/synth/recipes.js';
import { AssetProbe, memoizeBytes } from './audio/lab/assetProbe.js';
import { runAutotest } from './audio/lab/autotest.js';
import { bytesToBase64 } from './audio/lab/base64.js';
import { emptyReport, type SoundLabReport } from './audio/lab/labReport.js';
import { LiveTimeline } from './audio/lab/liveTimeline.js';
import { renderAndMeasure, type MeasuredMix } from './audio/lab/mixReport.js';
import { buildMixScenario, parseScenarioList } from './audio/lab/mixScenarios.js';
import type { MixScenarioName } from './audio/lab/mixTypes.js';
import type { OfflineContext } from './audio/lab/offlineMix.js';
import type { LabControls } from './audio/lab/panel/labControls.js';
import { mountLabPanel } from './audio/lab/panel/labPanel.js';
import { probeVoices } from './audio/lab/voiceProbe.js';

declare global {
  interface Window {
    /** The autotest's findings, filled in as it runs; `done` flips last. JSON-serialisable. */
    __soundLab?: SoundLabReport;
    /** A finished mix as a base64 WAV, or null when that mix was not rendered. */
    __soundLabWav?: (name: string) => string | null;
  }
}

const params = new URLSearchParams(window.location.search);
const autotest = params.get('autotest') === '1';

const fetchBytes = memoizeBytes(fetchArrayBuffer);

// The live engine, wired like the game's but with every injection point probed.
const manager = new AudioManager();
const probe = new AssetProbe();
const context = manager.context;
const engineOptions: AudioEngineOptions = context
  ? {
    random: new Random(LAB_RENDER_CONFIG.seed),
    fetchBytes: probe.wrapFetch(fetchBytes),
    decode: probe.wrapDecode(bytes => context.decodeAudioData(bytes)),
    recipes: probe.wrapRecipes(SYNTH_RECIPES),
    renderImpulse: probe.wrapImpulse(renderReverbIr),
  }
  : { random: new Random(LAB_RENDER_CONFIG.seed) };
const engine = new AudioEngine(manager, engineOptions);
const voices = context ? probeVoices(context) : null;

const plan = planPreload(SOUND_CATALOG);
const expected = { samples: plan.essentialSamples.length + plan.otherSamples.length, recipes: plan.recipes.length };

// Rendered mixes, kept for the download button and for the check script.
const wavs = new Map<string, Uint8Array>();

function renderOffline(name: MixScenarioName): Promise<MeasuredMix> {
  return renderAndMeasure(buildMixScenario(name), {
    createContext: (channels, length, sampleRate) => new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate }) as unknown as OfflineContext,
    fetchBytes,
    onProgress: (message) => { if (window.__soundLab) window.__soundLab.progress = message; },
  });
}

function offerDownload(name: string, wav: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.wav`;
  link.click();
  URL.revokeObjectURL(url);
}

// Scripted scenarios played in real time.
const nowS = (): number => performance.now() / 1000;
const live: { blast: LiveTimeline | null; busy: LiveTimeline | null } = { blast: null, busy: null };

function startTimeline(name: MixScenarioName, durationS: number, onFinished: () => void): LiveTimeline {
  const scenario = buildMixScenario(name);
  const timeline = new LiveTimeline({
    player: engine, events: scenario.events, durationS, lookaheadS: (LAB_PANEL_CONFIG.liveStepMs * 2) / 1000, releaseS: 1, onFinished,
  });
  timeline.start(nowS());
  return timeline;
}

const controls: LabControls = {
  player: engine,
  getVolume: channel => manager.getVolume(channel),
  setVolume: (channel, value) => { manager.setVolume(channel, value); },
  status: () => {
    const assets = probe.report();
    return {
      contextState: context?.state ?? 'unavailable',
      ready: engine.ready,
      voices: voices?.active() ?? 0,
      peakVoices: voices?.peak() ?? 0,
      loaded: assets.loaded.length,
      expected: expected.samples + expected.recipes + 1,
      failed: assets.failed,
    };
  },
  assets: () => probe.report(),
  playBlast: () => {
    live.blast?.stop();
    const scenario = buildMixScenario('blast');
    live.blast = startTimeline('blast', scenario.durationS, () => { live.blast = null; });
  },
  toggleBusyMine: () => {
    if (live.busy?.running) {
      live.busy.stop();
      return false;
    }
    live.busy = startTimeline('busy-mine', LAB_PANEL_CONFIG.busyMineLiveS, () => { live.busy = null; });
    return true;
  },
  stopAll: () => {
    live.blast?.stop();
    live.busy?.stop();
    engine.dispose();
  },
  downloadMix: async (name) => {
    const measured = await renderOffline(name);
    wavs.set(name, measured.wav);
    offerDownload(name, measured.wav);
    return measured.report;
  },
};

window.setInterval(() => {
  const now = nowS();
  live.blast?.update(now);
  live.busy?.update(now);
}, LAB_PANEL_CONFIG.liveStepMs);

// Browsers start audio only inside a gesture: the first click on the page does it.
document.addEventListener('pointerdown', () => { void manager.resume(); }, { once: true });
document.addEventListener('keydown', () => { void manager.resume(); }, { once: true });

const root = document.getElementById('lab-root');
if (!root) throw new Error('sound lab: #lab-root is missing');
const panel = mountLabPanel(root, controls);
window.setInterval(() => { panel.refreshStatus(); }, LAB_PANEL_CONFIG.statusIntervalMs);

if (autotest) {
  const report = emptyReport();
  window.__soundLab = report;
  window.__soundLabWav = name => {
    const wav = wavs.get(name);
    return wav ? bytesToBase64(wav) : null;
  };
  void runAutotest({
    live: {
      preload: onProgress => engine.preload(onProgress),
      resume: () => manager.resume(),
      contextState: () => context?.state ?? 'unavailable',
      clockS: () => context?.currentTime ?? 0,
      sampleRate: () => context?.sampleRate ?? 0,
      ready: () => engine.ready,
      assets: () => probe.report(),
      expected: () => expected,
      playSmoke: () => engine.play('ui_click') !== null,
    },
    scenarios: parseScenarioList(params.get('scenarios')),
    renderMix: renderOffline,
    keepWav: (name, wav) => { wavs.set(name, wav); },
    wait: ms => new Promise(resolve => window.setTimeout(resolve, ms)),
  }, report);
} else {
  void engine.preload();
}

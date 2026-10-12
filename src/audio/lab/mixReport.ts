// BlastSimulator2026 — Mix report
// Renders a scenario offline and turns the PCM into what the lab hands out: the
// measurements for the report and the WAV file for the ears.

import type { MixReport } from './labReport.js';
import type { MixScenario } from './mixTypes.js';
import { renderMix, type OfflineMixDeps, type RenderedMix } from './offlineMix.js';
import { measurePcm } from './pcmStats.js';
import { encodeWav16 } from './wav.js';

export interface MeasuredMix {
  readonly report: MixReport;
  readonly wav: Uint8Array;
}

export function buildMixReport(scenario: MixScenario, rendered: RenderedMix): MixReport {
  return {
    name: scenario.name,
    title: scenario.title,
    scenarioDurationS: scenario.durationS,
    stats: measurePcm(rendered.channels, rendered.sampleRate),
    requested: rendered.requested,
    dropped: rendered.dropped,
    droppedById: rendered.droppedById,
    peakVoices: rendered.peakVoices,
    failedAssets: rendered.failedAssets,
    renderMs: rendered.renderMs,
  };
}

export async function renderAndMeasure(scenario: MixScenario, deps: OfflineMixDeps): Promise<MeasuredMix> {
  const rendered = await renderMix(scenario, deps);
  return { report: buildMixReport(scenario, rendered), wav: encodeWav16(rendered.channels, rendered.sampleRate) };
}

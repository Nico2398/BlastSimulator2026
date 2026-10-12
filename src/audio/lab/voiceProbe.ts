// BlastSimulator2026 — Voice probe
// Counts the sound sources alive on a context (scheduled ones included, exactly as
// the engine's voice budget counts them), by watching the context create and start
// them. It never changes what the engine plays: it only listens.

/** The part of a context the probe hooks. */
interface SourceFactory {
  createBufferSource(): AudioBufferSourceNode;
}

interface VoiceProbe {
  /** Sources started and not yet ended. */
  active(): number;
  /** Highest `active()` seen. */
  peak(): number;
}

export function probeVoices(context: SourceFactory): VoiceProbe {
  let active = 0;
  let peak = 0;
  const create = context.createBufferSource.bind(context);
  context.createBufferSource = () => {
    const source = create();
    const start = source.start.bind(source);
    let started = false;
    source.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
      start(...args);
      if (started) return;
      started = true;
      peak = Math.max(peak, ++active);
      source.addEventListener?.('ended', () => { active--; });
    };
    return source;
  };
  return { active: () => active, peak: () => peak };
}

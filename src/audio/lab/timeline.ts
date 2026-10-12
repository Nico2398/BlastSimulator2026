// BlastSimulator2026 — Mix timeline tools
// Building a sorted event list, walking it in real time, and planning when an
// offline render has to stop to book the next stretch of sounds.

import type { DuckMixEvent, LoopMixEvent, MixEvent, PlayMixEvent } from './mixTypes.js';

/** Collects events in any order; `build()` returns them sorted by time (stable for equal times). */
export class TimelineBuilder {
  private readonly events: MixEvent[] = [];

  play(t: number, id: PlayMixEvent['id'], opts?: PlayMixEvent['opts']): this {
    this.events.push(opts ? { kind: 'play', t, id, opts } : { kind: 'play', t, id });
    return this;
  }

  loop(t: number, id: LoopMixEvent['id'], level: number, rampS?: number): this {
    this.events.push(rampS === undefined ? { kind: 'loop', t, id, level } : { kind: 'loop', t, id, level, rampS });
    return this;
  }

  duck(t: number, bus: DuckMixEvent['bus'], amountDb: number, holdS: number, releaseS: number): this {
    this.events.push({ kind: 'duck', t, bus, amountDb, holdS, releaseS });
    return this;
  }

  build(): MixEvent[] {
    return this.events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.t - b.event.t || a.index - b.index)
      .map(entry => entry.event);
  }
}

/** Walks a sorted event list: each `take(untilS)` returns the events not yet handed out that start before `untilS`. */
export class TimelineCursor {
  private next = 0;

  constructor(private readonly events: readonly MixEvent[]) {}

  get done(): boolean { return this.next >= this.events.length; }

  take(untilS: number): MixEvent[] {
    const due: MixEvent[] = [];
    while (this.next < this.events.length && (this.events[this.next]?.t ?? Infinity) < untilS) {
      const event = this.events[this.next];
      if (event) due.push(event);
      this.next++;
    }
    return due;
  }
}

/** Events to hand to the player while an offline render is paused at `atS`. */
interface DispatchBatch {
  readonly atS: number;
  readonly events: readonly MixEvent[];
}

interface DispatchPlan {
  readonly stepS: number;
  readonly quantumS: number;
  readonly durationS: number;
}

/**
 * Decide where an offline render pauses and what to book at each pause.
 * A one-shot is booked at the last pause of a regular grid at or before its start
 * (so at most one step ahead, with a sample-accurate delay); a loop or duck event
 * acts at the moment it is issued, so it gets a pause of its own at the first
 * render quantum at or after its time. Events outside the render are dropped.
 */
export function planDispatch(events: readonly MixEvent[], plan: DispatchPlan): DispatchBatch[] {
  const { stepS, quantumS, durationS } = plan;
  const epsilon = 1e-9;
  const batches = new Map<number, MixEvent[]>();
  for (const event of events) {
    if (event.t >= durationS || event.t < 0) continue;
    const key = event.kind === 'play'
      ? Math.floor((Math.floor(event.t / stepS + epsilon) * stepS) / quantumS + epsilon)
      : Math.ceil(event.t / quantumS - epsilon);
    const list = batches.get(key);
    if (list) list.push(event);
    else batches.set(key, [event]);
  }
  return [...batches.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, list]) => ({ atS: key * quantumS, events: list }));
}

// BlastSimulator2026 — Fakes for the music tests
// A recording AudioContext (only what the music player touches) and a fake
// HTMLAudioElement whose play() outcome the test controls.

export interface CurveEvent {
  readonly values: Float32Array;
  readonly start: number;
  readonly duration: number;
}

export class FakeGainParam {
  readonly sets: Array<{ value: number; time: number }> = [];
  readonly curves: CurveEvent[] = [];
  readonly ramps: Array<{ value: number; time: number }> = [];
  cancels: number[] = [];
  throwOnCurve = false;
  /** setValueAtTime throws, as Firefox/Safari may when the time lies inside a running curve. */
  throwOnSet = false;
  /** Assigning `value` throws too: a param that refuses everything. */
  throwOnAssign = false;
  private current = 1;

  get value(): number { return this.current; }

  set value(v: number) {
    if (this.throwOnAssign) throw new Error('InvalidStateError');
    this.current = v;
  }

  setValueAtTime(value: number, time: number): void {
    if (this.throwOnSet) throw new Error('NotSupportedError');
    this.sets.push({ value, time });
    this.current = value;
  }

  setValueCurveAtTime(values: Float32Array, start: number, duration: number): void {
    if (this.throwOnCurve) throw new Error('NotSupportedError');
    this.curves.push({ values, start, duration });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.ramps.push({ value, time });
  }

  cancelScheduledValues(time: number): void {
    this.cancels.push(time);
  }
}

export class FakeAudioNode {
  readonly outputs: FakeAudioNode[] = [];
  disconnected = false;

  connect(target: FakeAudioNode): FakeAudioNode {
    this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeGainParam();
}

export class FakeSourceNode extends FakeAudioNode {
  constructor(readonly element: FakeElement) {
    super();
  }
}

export class FakeElement {
  loop = false;
  preload = '';
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  attributes = new Map<string, string>([['src', '']]);
  /** What the next play() does: resolve, or reject with this error. */
  playError: Error | null = null;

  constructor(readonly url: string) {
    this.attributes.set('src', url);
  }

  play(): Promise<void> {
    this.playCalls++;
    if (this.playError) return Promise.reject(this.playError);
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls++;
    this.paused = true;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  load(): void {
    this.loadCalls++;
  }
}

export class FakeMusicContext {
  currentTime = 0;
  readonly sources: FakeSourceNode[] = [];
  readonly gains: FakeGainNode[] = [];
  throwOnSource = false;

  createMediaElementSource(element: FakeElement): FakeSourceNode {
    if (this.throwOnSource) throw new Error('InvalidStateError');
    const source = new FakeSourceNode(element);
    this.sources.push(source);
    return source;
  }

  createGain(): FakeGainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }
}

export class FakeMusicOutput {
  readonly bus = new FakeGainNode();
  readonly ducks: Array<{ bus: string; amountDb: number; holdS: number; releaseS: number }> = [];
  constructor(readonly context: FakeMusicContext | null = new FakeMusicContext()) {}

  busInput(): FakeGainNode {
    return this.bus;
  }

  duck(bus: string, amountDb: number, holdS: number, releaseS: number): void {
    this.ducks.push({ bus, amountDb, holdS, releaseS });
  }
}

/** Element factory that records every element it hands out; `refusePlay` makes new elements reject play(). */
export function recordingFactory(): {
  create: (url: string) => HTMLAudioElement;
  elements: FakeElement[];
  refusePlay: boolean;
} {
  const factory = {
    elements: [] as FakeElement[],
    refusePlay: false,
    create: (url: string): HTMLAudioElement => {
      const element = new FakeElement(url);
      if (factory.refusePlay) element.playError = new Error('NotAllowedError');
      factory.elements.push(element);
      return element as unknown as HTMLAudioElement;
    },
  };
  return factory;
}

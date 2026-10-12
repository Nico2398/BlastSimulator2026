// BlastSimulator2026 — Fake Web Audio for unit tests
// A hand-rolled AudioContext that records which nodes were created, how they
// were connected and which automation was scheduled on each AudioParam, so a
// test can assert on the graph the engine built without a browser.

export interface ParamEvent {
  readonly type: 'set' | 'linear' | 'target' | 'cancel';
  readonly value: number;
  readonly time: number;
  readonly timeConstant?: number;
}

export class FakeParam {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(initial: number, private readonly clock: { currentTime: number }) {
    this.value = initial;
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'set', value, time });
    if (time <= this.clock.currentTime) this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'linear', value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    this.events.push({ type: 'target', value, time, timeConstant });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', value: 0, time });
    return this;
  }

  /** Events other than the bookkeeping `cancel`. */
  get scheduled(): ParamEvent[] { return this.events.filter(e => e.type !== 'cancel'); }
}

export type FakeKind = 'gain' | 'biquad' | 'panner' | 'source' | 'compressor' | 'shaper' | 'convolver' | 'destination';

export class FakeNode {
  readonly outputs: FakeNode[] = [];
  disconnected = false;

  constructor(readonly kind: FakeKind, readonly ctx: FakeAudioContext) {}

  connect(target: FakeNode): FakeNode {
    this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnected = true;
    this.outputs.length = 0;
  }

  /** True when `target` is reachable from this node through connections. */
  reaches(target: FakeNode): boolean {
    const seen = new Set<FakeNode>();
    const stack: FakeNode[] = [this];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === target) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...node.outputs);
    }
    return false;
  }
}

export class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super('gain', ctx);
    this.gain = new FakeParam(1, ctx);
  }
}

export class FakeBiquad extends FakeNode {
  type = 'lowpass';
  readonly frequency: FakeParam;
  readonly Q: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super('biquad', ctx);
    this.frequency = new FakeParam(350, ctx);
    this.Q = new FakeParam(1, ctx);
  }
}

export class FakePanner extends FakeNode {
  readonly pan: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super('panner', ctx);
    this.pan = new FakeParam(0, ctx);
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold: FakeParam;
  readonly knee: FakeParam;
  readonly ratio: FakeParam;
  readonly attack: FakeParam;
  readonly release: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super('compressor', ctx);
    this.threshold = new FakeParam(-24, ctx);
    this.knee = new FakeParam(30, ctx);
    this.ratio = new FakeParam(12, ctx);
    this.attack = new FakeParam(0.003, ctx);
    this.release = new FakeParam(0.25, ctx);
  }
}

export class FakeWaveShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample: 'none' | '2x' | '4x' = 'none';
  constructor(ctx: FakeAudioContext) {
    super('shaper', ctx);
  }
}

export class FakeConvolver extends FakeNode {
  buffer: FakeAudioBuffer | null = null;
  normalize = true;
  constructor(ctx: FakeAudioContext) {
    super('convolver', ctx);
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  readonly playbackRate: FakeParam;
  onended: (() => void) | null = null;
  /** Arguments of every start() call. */
  readonly starts: Array<{ when: number; offset: number | undefined }> = [];
  /** Argument of every stop() call. */
  readonly stops: number[] = [];

  constructor(ctx: FakeAudioContext) {
    super('source', ctx);
    this.playbackRate = new FakeParam(1, ctx);
  }

  start(when = 0, offset?: number): void {
    this.starts.push({ when, offset });
  }

  stop(when = 0): void {
    this.stops.push(when);
  }

  /** Simulate the source finishing playback. */
  end(): void {
    this.onended?.();
  }
}

export class FakeAudioBuffer {
  readonly channels: Float32Array[];
  readonly duration: number;

  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    this.duration = length / sampleRate;
  }

  copyToChannel(source: Float32Array, channel: number): void {
    this.channels[channel]!.set(source);
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!;
  }
}

export class FakeAudioContext {
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  readonly sampleRate = 48000;
  readonly destination = new FakeNode('destination', this);
  /** Every node created, in order. */
  readonly nodes: FakeNode[] = [];
  readonly resumeCalls: number[] = [];
  readonly suspendCalls: number[] = [];
  closed = false;
  /** Make createBufferSource and friends throw, to exercise failure paths. */
  failNodeCreation = false;
  /** Make resume() reject. */
  failResume = false;

  private track<T extends FakeNode>(node: T): T {
    if (this.failNodeCreation) throw new Error('node creation failed');
    this.nodes.push(node);
    return node;
  }

  createGain(): FakeGain { return this.track(new FakeGain(this)); }
  createBiquadFilter(): FakeBiquad { return this.track(new FakeBiquad(this)); }
  createStereoPanner(): FakePanner { return this.track(new FakePanner(this)); }
  createDynamicsCompressor(): FakeCompressor { return this.track(new FakeCompressor(this)); }
  createWaveShaper(): FakeWaveShaper { return this.track(new FakeWaveShaper(this)); }
  createConvolver(): FakeConvolver { return this.track(new FakeConvolver(this)); }
  createBufferSource(): FakeSource { return this.track(new FakeSource(this)); }

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }

  decodeAudioData(bytes: ArrayBuffer): Promise<FakeAudioBuffer> {
    return Promise.resolve(new FakeAudioBuffer(1, Math.max(1, bytes.byteLength), this.sampleRate));
  }

  resume(): Promise<void> {
    this.resumeCalls.push(this.currentTime);
    if (this.failResume) return Promise.reject(new Error('resume refused'));
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls.push(this.currentTime);
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }

  /** All created nodes of one kind, typed. */
  all<T extends FakeNode>(kind: FakeKind): T[] {
    return this.nodes.filter(n => n.kind === kind) as T[];
  }

  sources(): FakeSource[] { return this.all<FakeSource>('source'); }
}

/** View a fake context as the real type the engine is written against. */
export function asAudioContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext;
}

/** View a fake node as the real node type. */
export function asNode(node: FakeNode): AudioNode {
  return node as unknown as AudioNode;
}

export function asBuffer(buffer: FakeAudioBuffer): AudioBuffer {
  return buffer as unknown as AudioBuffer;
}

/** A decoded-sample stand-in of the given length in seconds. */
export function fakeBuffer(seconds = 1, sampleRate = 48000): AudioBuffer {
  return asBuffer(new FakeAudioBuffer(1, Math.round(seconds * sampleRate), sampleRate));
}

/** A visibility source tests can flip. */
export class FakeVisibility {
  hidden = false;
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void): void { this.listeners.add(listener); }
  removeEventListener(_type: 'visibilitychange', listener: () => void): void { this.listeners.delete(listener); }

  get listenerCount(): number { return this.listeners.size; }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of [...this.listeners]) listener();
  }
}

// BlastSimulator2026 — AudioManager unit tests
// Runs against a hand-rolled fake AudioContext that records the graph and the
// automation scheduled on every AudioParam.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { AudioManager, type AudioCategory } from '../../../src/audio/AudioManager.js';
import { buildSoftClipCurve } from '../../../src/audio/engine/softClip.js';
import { AUDIO_DEFAULT_VOLUMES } from '../../../src/core/config/balance.js';
import { DUCK_CONFIG, MASTER_LIMITER_CONFIG, MIXER_CONFIG } from '../../../src/core/config/audio/engine.js';
import {
  FakeAudioContext, FakeCompressor, FakeConvolver, FakeGain, FakeVisibility, FakeWaveShaper, asAudioContext, asNode, fakeBuffer,
  type FakeNode,
} from '../../helpers/audioFakes.js';

function make(options: { visibility?: FakeVisibility | null } = {}) {
  const ctx = new FakeAudioContext();
  const visibility = options.visibility === undefined ? new FakeVisibility() : options.visibility;
  const manager = new AudioManager({ createContext: () => asAudioContext(ctx), document: visibility });
  return { ctx, manager, visibility };
}

const gainOf = (node: AudioNode): FakeGain => node as unknown as FakeGain;
const BUS_TIMES = (n: FakeNode): FakeNode[] => n.outputs;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('graph', () => {
  it('ends in a limiter-configured compressor feeding the safety clipper, then the destination', () => {
    const { ctx } = make();
    const limiter = ctx.all<FakeCompressor>('compressor')[0]!;
    const clipper = ctx.all<FakeWaveShaper>('shaper')[0]!;
    expect(limiter.outputs).toEqual([clipper]);
    expect(clipper.outputs).toEqual([ctx.destination]);
    expect(limiter.threshold.value).toBe(MASTER_LIMITER_CONFIG.thresholdDb);
    expect(limiter.knee.value).toBe(MASTER_LIMITER_CONFIG.kneeDb);
    expect(limiter.ratio.value).toBe(MASTER_LIMITER_CONFIG.ratio);
    expect(limiter.attack.value).toBe(MASTER_LIMITER_CONFIG.attackS);
    expect(limiter.release.value).toBe(MASTER_LIMITER_CONFIG.releaseS);
  });

  it('shapes the clipper with the soft-clip curve at the configured oversampling', () => {
    const { ctx } = make();
    const clipper = ctx.all<FakeWaveShaper>('shaper')[0]!;
    const expected = buildSoftClipCurve(MASTER_LIMITER_CONFIG.clipCurveSize, MASTER_LIMITER_CONFIG.clipKnee, MASTER_LIMITER_CONFIG.clipCeiling);
    expect(clipper.oversample).toBe(MASTER_LIMITER_CONFIG.clipOversample);
    expect(clipper.curve).toEqual(expected);
    expect(ctx.all<FakeWaveShaper>('shaper')).toHaveLength(1);
  });

  it('chains master gain, limiter, clipper and destination in that order', () => {
    const { ctx } = make();
    const limiter = ctx.all<FakeCompressor>('compressor')[0]!;
    const clipper = ctx.all<FakeWaveShaper>('shaper')[0]!;
    const master = ctx.all<FakeGain>('gain').find(g => g.outputs.includes(limiter))!;
    expect(master.outputs).toEqual([limiter]);
    expect(master.reaches(clipper)).toBe(true);
    expect(clipper.reaches(master)).toBe(false);
    expect(clipper.reaches(ctx.destination)).toBe(true);
  });

  it('routes every bus through volume and duck gains into the master, then the limiter', () => {
    const { ctx, manager } = make();
    const limiter = ctx.all<FakeCompressor>('compressor')[0]!;
    const master = ctx.all<FakeGain>('gain').find(g => g.outputs.includes(limiter))!;
    for (const bus of ['effects', 'ambient', 'ui', 'music'] as AudioCategory[]) {
      const input = manager.busInput(bus) as unknown as FakeNode;
      expect(input.reaches(master)).toBe(true);
      expect(BUS_TIMES(input)).toHaveLength(1);
      expect(input.reaches(limiter)).toBe(true);
    }
  });

  it('feeds each reverb lane into the convolver, then the master', () => {
    const { ctx, manager } = make();
    const convolver = ctx.all<FakeConvolver>('convolver')[0]!;
    const limiter = ctx.all<FakeCompressor>('compressor')[0]!;
    for (const bus of ['effects', 'ambient', 'ui', 'music'] as AudioCategory[]) {
      const wet = manager.reverbInput(bus) as unknown as FakeNode;
      expect(wet.reaches(convolver)).toBe(true);
      expect(wet).not.toBe(manager.busInput(bus));
    }
    expect(convolver.reaches(limiter)).toBe(true);
    const returnGain = convolver.outputs[0] as FakeGain;
    expect(returnGain.gain.value).toBe(MIXER_CONFIG.reverbReturnGain);
  });

  it('defaults the reverb input to the effects bus', () => {
    const { manager } = make();
    expect(manager.reverbInput()).toBe(manager.reverbInput('effects'));
  });

  it('exposes the context', () => {
    const { ctx, manager } = make();
    expect(manager.context).toBe(ctx);
  });

  it('installs the reverb impulse, and tolerates a convolver that rejects it', () => {
    const { ctx, manager } = make();
    const buffer = fakeBuffer(1);
    manager.setReverbImpulse(buffer);
    expect(ctx.all<FakeConvolver>('convolver')[0]!.buffer).toBe(buffer);

    const convolver = ctx.all<FakeConvolver>('convolver')[0]!;
    Object.defineProperty(convolver, 'buffer', { set() { throw new Error('NotSupportedError'); }, get: () => null });
    expect(() => manager.setReverbImpulse(buffer)).not.toThrow();
  });
});

describe('volumes', () => {
  it('starts at the default volumes, on the graph too', () => {
    const { manager } = make();
    for (const channel of Object.keys(AUDIO_DEFAULT_VOLUMES) as Array<keyof typeof AUDIO_DEFAULT_VOLUMES>) {
      expect(manager.getVolume(channel)).toBe(AUDIO_DEFAULT_VOLUMES[channel]);
    }
    expect(gainOf(manager.busInput('ambient')).gain.value).toBe(AUDIO_DEFAULT_VOLUMES.ambient);
    expect(gainOf(manager.reverbInput('music')).gain.value).toBe(AUDIO_DEFAULT_VOLUMES.music);
  });

  it('applies a bus volume smoothly to its dry and reverb lanes', () => {
    const { ctx, manager } = make();
    ctx.currentTime = 4;
    manager.setVolume('ui', 0.25);
    expect(manager.getVolume('ui')).toBe(0.25);
    for (const node of [manager.busInput('ui'), manager.reverbInput('ui')]) {
      const events = gainOf(node).gain.events;
      expect(events.at(-1)).toMatchObject({ type: 'target', value: 0.25, time: 4, timeConstant: MIXER_CONFIG.volumeSmoothS });
    }
    expect(gainOf(manager.busInput('effects')).gain.events).toEqual([]);
  });

  it('applies the master volume to the master gain', () => {
    const { ctx, manager } = make();
    manager.setVolume('master', 0.4);
    const limiter = ctx.all<FakeCompressor>('compressor')[0]!;
    const master = ctx.all<FakeGain>('gain').find(g => g.outputs.includes(limiter))!;
    expect(master.gain.events.at(-1)).toMatchObject({ type: 'target', value: 0.4 });
  });

  it('clamps to 0..1 and ignores NaN', () => {
    const { manager } = make();
    manager.setVolume('effects', -1);
    expect(manager.getVolume('effects')).toBe(0);
    manager.setVolume('effects', 999);
    expect(manager.getVolume('effects')).toBe(1);
    manager.setVolume('effects', 0.3);
    manager.setVolume('effects', Number.NaN);
    expect(manager.getVolume('effects')).toBe(0.3);
  });

  it('applyVolumes sets the given channels and leaves the others', () => {
    const { manager } = make();
    manager.applyVolumes({ master: 0.5, music: 0.2 });
    expect(manager.getVolume('master')).toBe(0.5);
    expect(manager.getVolume('music')).toBe(0.2);
    expect(manager.getVolume('ui')).toBe(AUDIO_DEFAULT_VOLUMES.ui);
    expect(manager.getVolume('effects')).toBe(AUDIO_DEFAULT_VOLUMES.effects);
  });
});

describe('mute', () => {
  function masterOf(ctx: FakeAudioContext): FakeGain {
    const limiter = ctx.all<FakeCompressor>('compressor')[0]!;
    return ctx.all<FakeGain>('gain').find(g => g.outputs.includes(limiter))!;
  }

  it('silences the master immediately, with no ramp', () => {
    const { ctx, manager } = make();
    manager.setMuted(true);
    expect(manager.isMuted).toBe(true);
    const master = masterOf(ctx);
    expect(master.gain.value).toBe(0);
    expect(master.gain.events.map(e => e.type)).toEqual(['cancel', 'set']);
  });

  it('keeps master volume changes while muted but does not play them', () => {
    const { ctx, manager } = make();
    manager.setMuted(true);
    manager.setVolume('master', 0.9);
    expect(manager.getVolume('master')).toBe(0.9);
    expect(masterOf(ctx).gain.value).toBe(0);
    expect(masterOf(ctx).gain.events.some(e => e.type === 'target')).toBe(false);
  });

  it('unmuting returns to the stored master volume smoothly', () => {
    const { ctx, manager } = make();
    manager.setVolume('master', 0.6);
    manager.setMuted(true);
    manager.setMuted(false);
    expect(manager.isMuted).toBe(false);
    expect(masterOf(ctx).gain.events.at(-1)).toMatchObject({ type: 'target', value: 0.6 });
  });
});

describe('ducking', () => {
  const dryGain = (m: AudioManager, bus: AudioCategory): FakeGain => (gainOf(m.busInput(bus)).outputs[0] as FakeGain);
  const wetGain = (m: AudioManager, bus: AudioCategory): FakeGain => (gainOf(m.reverbInput(bus)).outputs[0] as FakeGain);

  it('schedules attack, hold and exponential release on the dry and wet lanes', () => {
    const { ctx, manager } = make();
    ctx.currentTime = 2;
    manager.duck('ambient', -12, 1.5, 2);
    for (const gain of [dryGain(manager, 'ambient'), wetGain(manager, 'ambient')]) {
      const events = gain.gain.events;
      expect(events.map(e => e.type)).toEqual(['cancel', 'set', 'linear', 'set', 'target', 'set']);
      expect(events[2]).toMatchObject({ value: 10 ** (-12 / 20), time: 2 + DUCK_CONFIG.attackS });
      expect(events[3]).toMatchObject({ time: 3.5 });
      expect(events[4]).toMatchObject({ value: 1, time: 3.5, timeConstant: 2 / DUCK_CONFIG.releaseTimeConstants });
      expect(events[5]).toMatchObject({ value: 1, time: 5.5 });
    }
    expect(dryGain(manager, 'effects').gain.events).toEqual([]);
  });

  it('keeps the deeper duck when a shallower one overlaps', () => {
    const { ctx, manager } = make();
    manager.duck('ambient', -18, 2, 1);
    ctx.currentTime = 0.5;
    manager.duck('ambient', -6, 0.5, 1);
    const linear = dryGain(manager, 'ambient').gain.events.filter(e => e.type === 'linear');
    expect(linear.at(-1)!.value).toBeCloseTo(10 ** (-18 / 20), 10);
  });

  it('takes the deeper level when a deeper duck overlaps a shallower one', () => {
    const { ctx, manager } = make();
    manager.duck('ambient', -6, 2, 1);
    ctx.currentTime = 0.5;
    manager.duck('ambient', -24, 0.5, 1);
    const linear = dryGain(manager, 'ambient').gain.events.filter(e => e.type === 'linear');
    expect(linear.at(-1)!.value).toBeCloseTo(10 ** (-24 / 20), 10);
  });

  it('releases fully once the duck has run its course, then ducks afresh', () => {
    const { ctx, manager } = make();
    manager.duck('ui', -12, 1, 1);
    ctx.currentTime = 10;
    manager.duck('ui', -3, 1, 1);
    const events = dryGain(manager, 'ui').gain.events;
    const setAtNow = events.filter(e => e.type === 'set' && e.time === 10);
    expect(setAtNow[0]!.value).toBe(1);
    expect(events.filter(e => e.type === 'linear').at(-1)!.value).toBeCloseTo(10 ** (-3 / 20), 10);
  });

  it('limits how deep a duck can go and ignores a request that attenuates nothing', () => {
    const { manager } = make();
    manager.duck('music', -500, 1, 1);
    const linear = dryGain(manager, 'music').gain.events.filter(e => e.type === 'linear');
    expect(linear[0]!.value).toBeCloseTo(10 ** (DUCK_CONFIG.maxDepthDb / 20), 12);
    manager.duck('effects', 6, 1, 1);
    expect(dryGain(manager, 'effects').gain.events).toEqual([]);
  });

  it('accepts a negative hold or release as zero', () => {
    const { manager } = make();
    expect(() => manager.duck('ui', -6, -1, -1)).not.toThrow();
  });
});

describe('suspend, resume and page visibility', () => {
  it('resumes a suspended context and leaves a running one alone', async () => {
    const { ctx, manager } = make();
    await manager.resume();
    expect(ctx.resumeCalls).toHaveLength(0);
    ctx.state = 'suspended';
    await manager.resume();
    expect(ctx.resumeCalls).toHaveLength(1);
    expect(ctx.state).toBe('running');
  });

  it('swallows a refused resume', async () => {
    const { ctx, manager } = make();
    ctx.state = 'suspended';
    ctx.failResume = true;
    await expect(manager.resume()).resolves.toBeUndefined();
  });

  it('suspend pauses a running context only', () => {
    const { ctx, manager } = make();
    manager.suspend();
    expect(ctx.suspendCalls).toHaveLength(1);
    manager.suspend();
    expect(ctx.suspendCalls).toHaveLength(1);
  });

  it('suspends while the page is hidden and resumes when it is shown again', () => {
    const { ctx, visibility } = make();
    visibility!.setHidden(true);
    expect(ctx.state).toBe('suspended');
    visibility!.setHidden(false);
    expect(ctx.resumeCalls).toHaveLength(1);
    expect(ctx.state).toBe('running');
  });

  it('does not resume on show a context that was not running when hidden', () => {
    const { ctx, visibility } = make();
    ctx.state = 'suspended';
    visibility!.setHidden(true);
    visibility!.setHidden(false);
    expect(ctx.suspendCalls).toHaveLength(0);
    expect(ctx.resumeCalls).toHaveLength(0);
  });

  it('does not resume on show after an explicit suspend', () => {
    const { ctx, manager, visibility } = make();
    visibility!.setHidden(true);
    manager.suspend();
    visibility!.setHidden(false);
    expect(ctx.resumeCalls).toHaveLength(0);
  });

  it('a resume requested while hidden waits for the page to show', async () => {
    const { ctx, manager, visibility } = make();
    ctx.state = 'suspended';
    visibility!.hidden = true;
    await manager.resume();
    expect(ctx.resumeCalls).toHaveLength(0);
    visibility!.setHidden(false);
    expect(ctx.resumeCalls).toHaveLength(1);
  });

  it('swallows a refused resume on show', () => {
    const { ctx, visibility } = make();
    visibility!.setHidden(true);
    ctx.failResume = true;
    expect(() => visibility!.setHidden(false)).not.toThrow();
  });

  it('dispose closes the context and stops listening to visibility', () => {
    const { ctx, manager, visibility } = make();
    expect(visibility!.listenerCount).toBe(1);
    manager.dispose();
    expect(ctx.closed).toBe(true);
    expect(visibility!.listenerCount).toBe(0);
  });
});

describe('without Web Audio', () => {
  it('has no context when the browser has no AudioContext', () => {
    const manager = new AudioManager();
    expect(manager.context).toBeNull();
  });

  it('has no context when the constructor throws', () => {
    const manager = new AudioManager({ createContext: () => { throw new Error('blocked'); } });
    expect(manager.context).toBeNull();
  });

  it('still stores volumes and mute so settings keep working', () => {
    const manager = new AudioManager({ createContext: () => { throw new Error('blocked'); } });
    manager.setVolume('music', 0.1);
    manager.applyVolumes({ master: 0.2 });
    manager.setMuted(true);
    expect(manager.getVolume('music')).toBe(0.1);
    expect(manager.getVolume('master')).toBe(0.2);
    expect(manager.getVolume('ui')).toBe(AUDIO_DEFAULT_VOLUMES.ui);
    expect(manager.isMuted).toBe(true);
    manager.setMuted(false);
    expect(manager.isMuted).toBe(false);
  });

  it('turns every audio call into a no-op', async () => {
    const manager = new AudioManager();
    await expect(manager.resume()).resolves.toBeUndefined();
    expect(() => {
      manager.suspend();
      manager.duck('ui', -6, 1, 1);
      manager.setReverbImpulse(fakeBuffer(1));
      manager.dispose();
    }).not.toThrow();
  });

  it('refuses to hand out bus inputs', () => {
    const manager = new AudioManager();
    expect(() => manager.busInput('ui')).toThrow(/no Web Audio/);
    expect(() => manager.reverbInput('ui')).toThrow(/no Web Audio/);
  });
});

describe('default construction', () => {
  it('builds a context from the global AudioContext', () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal('AudioContext', function AudioContextStub() { return ctx; });
    const manager = new AudioManager();
    expect(manager.context).toBe(ctx);
    expect(asNode(ctx.destination)).toBeDefined();
  });

  it('uses the global document for visibility when there is one', () => {
    const ctx = new FakeAudioContext();
    const visibility = new FakeVisibility();
    vi.stubGlobal('AudioContext', function AudioContextStub() { return ctx; });
    vi.stubGlobal('document', visibility);
    const manager = new AudioManager();
    expect(visibility.listenerCount).toBe(1);
    manager.dispose();
    expect(visibility.listenerCount).toBe(0);
  });
});

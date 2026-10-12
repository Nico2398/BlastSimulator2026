// BlastSimulator2026 — Audio debug hook tests
// The URL flag gates everything: without it the player comes back untouched and the window is left alone.

import { describe, it, expect } from 'vitest';
import { installAudioDebug, isAudioLogRequested, type AudioDebugWindow, type AudioStatusSource } from '../../../../src/audio/debug/audioDebug.js';
import { NULL_AUDIO_PLAYER } from '../../../../src/audio/AudioPlayer.js';
import { AUDIO_DEBUG_CONFIG } from '../../../../src/core/config/audio/debug.js';

const idle: AudioStatusSource = { ready: false, preloaded: false, failedAssets: [], contextState: 'none' };

describe('isAudioLogRequested', () => {
  it.each([
    ['?audioLog=1', true],
    ['?scenarioMode=1&audioLog=1', true],
    ['?audioLog=0', false],
    ['?audioLog=true', false],
    ['?scenarioMode=1', false],
    ['', false],
  ])('%s -> %s', (search, expected) => {
    expect(isAudioLogRequested(search)).toBe(expected);
  });
});

describe('installAudioDebug', () => {
  it('does nothing without the flag: same player, no window members', () => {
    const win: AudioDebugWindow = {};
    expect(installAudioDebug(win, '?scenarioMode=1', NULL_AUDIO_PLAYER, () => idle)).toBe(NULL_AUDIO_PLAYER);
    expect(Object.keys(win)).toEqual([]);
  });

  it('with the flag publishes the log and records through the returned player', () => {
    const win: AudioDebugWindow = {};
    const player = installAudioDebug(win, '?audioLog=1', NULL_AUDIO_PLAYER, () => idle, () => 0);
    expect(player).not.toBe(NULL_AUDIO_PLAYER);
    player.play('ui_click');
    expect(win.__audioLog?.map(r => r.id)).toEqual(['ui_click']);
  });

  it('bounds the published log by the configured capacity', () => {
    const win: AudioDebugWindow = {};
    const player = installAudioDebug(win, '?audioLog=1', NULL_AUDIO_PLAYER, () => idle, () => 0);
    for (let i = 0; i < AUDIO_DEBUG_CONFIG.logCapacity + 10; i++) player.play('ui_hover');
    expect(win.__audioLog).toHaveLength(AUDIO_DEBUG_CONFIG.logCapacity);
  });

  it('answers the status from the live source on every call, as a copy', () => {
    const win: AudioDebugWindow = {};
    const source = { ...idle, failedAssets: ['a'] as string[] };
    installAudioDebug(win, '?audioLog=1', NULL_AUDIO_PLAYER, () => source, () => 0);
    const first = win.__audioStatus!();
    expect(first).toEqual({ ready: false, preloaded: false, contextState: 'none', failedAssets: ['a'] });
    source.failedAssets.push('b');
    expect(first.failedAssets).toEqual(['a']);
    expect(win.__audioStatus!().failedAssets).toEqual(['a', 'b']);
  });
});

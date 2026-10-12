// BlastSimulator2026 — main.ts audio wiring
//
// main.ts builds a SceneManager, a canvas and IndexedDB persistence as import-time side effects, so it
// cannot be constructed in a unit test (see MainLocaleWiring.test.ts). The audio wiring has rules a
// slip would break silently and nobody can hear in CI: one sound per command, one per blast, nothing for
// the tutorial's scripted commands, nothing loaded in a scenario run. This is a static-source check that
// each of those call sites exists where it must. What each cue does is covered by the audio and UI tests.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(import.meta.dirname, '../../..', 'src/main.ts'), 'utf8');

/** Body of `function <name>(` (or `function* <name>(`) up to the first closing brace at column zero. */
function functionBody(name: string): string {
  const start = source.search(new RegExp(`function\\*? ${name}\\(`));
  if (start === -1) throw new Error(`function not found in src/main.ts: ${name}`);
  const end = source.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`no end found for function: ${name}`);
  return source.slice(start, end);
}

/** The statement block assigned to `<marker> = ... => {` up to its closing `};` at column zero. */
function assignedBlock(marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`marker not found in src/main.ts: ${marker}`);
  const end = source.indexOf('\n};', start);
  if (end === -1) throw new Error(`no end found for marker: ${marker}`);
  return source.slice(start, end);
}

const occurrences = (needle: string): number => source.split(needle).length - 1;

describe('src/main.ts — commands are voiced once, by runGameCommand', () => {
  it('runGameCommand voices the command and tells the director, after afterGameCommand', () => {
    const body = functionBody('runGameCommand');
    expect(body).toContain('commandCue(audioPlayer, parsed, result.success');
    expect(body).toContain('gameAudio.onCommand({');
    expect(body.indexOf('afterGameCommand(')).toBeLessThan(body.indexOf('commandCue('));
  });

  it('afterGameCommand, which landBlast re-enters, makes no sound of its own', () => {
    const body = functionBody('afterGameCommand');
    expect(body).not.toContain('commandCue');
    expect(body).not.toContain('gameAudio');
    expect(body).not.toContain('uiCues');
  });

  it('only the tutorial console is scripted, and the player console is not', () => {
    expect(source).toContain('tutorial.setGameConsole((cmd) => runGameCommand(cmd, { scripted: true }));');
    expect(source).toContain('window.__gameConsole = (cmd: string) => runGameCommand(cmd);');
    expect(occurrences('scripted: true')).toBe(1);
    expect(functionBody('runGameCommand')).toContain('scripted: opts?.scripted === true');
  });
});

describe('src/main.ts — a blast is voiced once, where the renderer fires its flash', () => {
  it('registers one blast handler that reaches the director and ducks the music', () => {
    expect(occurrences('gameRenderer.setBlastTriggeredHandler(')).toBe(1);
    expect(occurrences('gameAudio.onBlast(')).toBe(1);
    const start = source.indexOf('gameRenderer.setBlastTriggeredHandler(');
    const handler = source.slice(start, source.indexOf('});', start));
    expect(handler).toContain('gameAudio.onBlast(info)');
    expect(handler).toContain('music?.duck()');
  });

  it('keeps the blast out of the landing and command paths', () => {
    expect(functionBody('landBlast')).not.toContain('gameAudio');
    expect(functionBody('stepBlastJob')).not.toContain('gameAudio');
  });

  it('routes lightning to the director', () => {
    expect(source).toContain('gameRenderer.setLightningHandler(() => gameAudio.onLightning());');
  });

  it('cancels the scheduled blast sounds when playback is skipped or sought', () => {
    expect(assignedBlock('window.__skipBlastPlayback = ')).toContain('gameAudio.cancelBlast()');
    expect(assignedBlock('window.__seekBlastPlayback = ')).toContain('gameAudio.cancelBlast()');
  });
});

describe('src/main.ts — the audio block', () => {
  it('builds no engine and preloads nothing in a scenario run, and preloads after the models', () => {
    expect(source).toContain('const audioEngine = scenarioMode ? null : new AudioEngine(');
    expect(source).toContain('const audioPlayer: AudioPlayer = audioEngine ?? NULL_AUDIO_PLAYER;');
    expect(source).toMatch(/if \(audioEngine\) void modelsReady\.[^\n]*audioEngine\.preload\(\)/);
    expect(occurrences('.preload(')).toBe(1);
  });

  it('streams no music in a scenario run', () => {
    expect(source).toContain('const music = scenarioMode ? null : createMusicDirector(audioMgr);');
  });

  it('unlocks audio on the first pointerdown or keydown, once, without awaiting the resume', () => {
    expect(source).toContain("document.addEventListener('pointerdown', unlockAudio, true);");
    expect(source).toContain("document.addEventListener('keydown', unlockAudio, true);");
    expect(source).toContain("document.removeEventListener('pointerdown', unlockAudio, true);");
    expect(source).toContain("document.removeEventListener('keydown', unlockAudio, true);");
    expect(source).toContain('void audioMgr.resume();');
    expect(source).not.toMatch(/await [^\n]*\.resume\(/);
    expect(source).toContain('music?.unlock();');
  });

  it('installs the interface sounds muting tutorial-inert controls', () => {
    expect(source).toContain('installUiSounds(document, audioPlayer, { isInert: target => isRailedControl(target) });');
    expect(source).toContain('uiManager.setUiCues(uiCues);');
  });

  it('voices scene selection and refused placement clicks', () => {
    expect(source).toContain('uiCues.entitySelected(entity.kind);');
    expect(source).toContain('placementController.setRefusedHandler(() => uiCues.placementRefused());');
  });

  it('keeps the four game-over toasts silent, since the director plays the lose sting', () => {
    expect(occurrences("severity: 'critical', silent: true")).toBe(4);
  });
});

describe('src/main.ts — the per-frame update', () => {
  const frame = source.slice(source.indexOf('scene.start((dt) => {'));

  it('updates the director with real seconds, the menu flag and a listener from the stable camera target', () => {
    expect(frame).toContain('gameAudio.update({');
    expect(frame).toContain('dtS: dt,');
    expect(frame).toContain('menuUp: fullScreenMenuUp(),');
    expect(frame).toContain('scene.cameraController.viewTarget');
    expect(frame).toContain('cameraGroundRight(scene.camera.matrixWorld.elements)');
    expect(frame).not.toContain('scene.camera.position');
  });

  it('follows the screen with the music context', () => {
    expect(frame).toContain('music?.update(deriveMusicContext({');
  });
});

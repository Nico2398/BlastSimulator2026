/**
 * BlastSimulator2026 — Interaction Recording & Playback Types
 *
 * Shared TypeScript interfaces for the interaction recording and replay
 * system used in visual testing. Defines the full event model, recording
 * format, and comparison result types.
 *
 * Format version: 1
 *
 * @module interaction-types
 */

// ── Event Type Discriminant ──

export type InteractionEventType =
  | 'click'
  | 'mousedown'
  | 'mouseup'
  | 'mousemove'
  | 'keypress'
  | 'keydown'
  | 'keyup'
  | 'scroll'
  | 'wheel'
  | 'wait'
  | 'assert'
  | 'viewport';

// ── Base Event ──

export interface InteractionEventBase {
  type: InteractionEventType;
  timestamp: number;
  screenshot?: boolean;
  label?: string;
}

// ── Modifier Keys ──

export interface Modifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

// ── Concrete Event Types ──

export interface ClickEvent extends InteractionEventBase {
  type: 'click' | 'mousedown' | 'mouseup';
  x: number;
  y: number;
  selector?: string;
  button: 'left' | 'right' | 'middle';
  modifiers?: Modifiers;
}

export interface MouseMoveEvent extends InteractionEventBase {
  type: 'mousemove';
  x: number;
  y: number;
}

export interface KeyEvent extends InteractionEventBase {
  type: 'keypress' | 'keydown' | 'keyup';
  key: string;
  code: string;
  modifiers?: Modifiers;
}

export interface ScrollEvent extends InteractionEventBase {
  type: 'scroll';
  x: number;
  y: number;
}

export interface WheelEvent extends InteractionEventBase {
  type: 'wheel';
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
}

export interface WaitEvent extends InteractionEventBase {
  type: 'wait';
  durationMs: number;
}

export interface AssertEvent extends InteractionEventBase {
  type: 'assert';
  selector?: string;
  property?: string;
  expectedValue?: unknown;
  eval?: string;
  gameStatePath?: string;
  uiStatePath?: string;
  timeout?: number;
}

export interface ViewportEvent extends InteractionEventBase {
  type: 'viewport';
  width: number;
  height: number;
}

// ── Union of All Event Types ──

export type InteractionRecordEvent =
  | ClickEvent
  | MouseMoveEvent
  | KeyEvent
  | ScrollEvent
  | WheelEvent
  | WaitEvent
  | AssertEvent
  | ViewportEvent;

// ── Recording Container ──

export interface InteractionRecording {
  name: string;
  description: string;
  meta: {
    viewport: { width: number; height: number };
    createdAt: string;
    durationMs: number;
    eventCount: number;
    formatVersion: number;
  };
  setupCommands: string[];
  waitForSelectors?: string[];
  events: InteractionRecordEvent[];
  expectedOutcome?: unknown;
}

// ── Comparison Types ──

export interface ScreenshotDiff {
  stepIndex: number;
  baselineFile: string;
  targetFile: string;
  pixelDiffPercent: number;
  diffImagePath?: string;
}

export interface StateDiff {
  stepIndex: number;
  field: string;
  baselineValue: unknown;
  targetValue: unknown;
}

export interface CompareResult {
  totalSteps: number;
  matchedSteps: number;
  divergedSteps: number;
  screenshotDiffs: ScreenshotDiff[];
  stateDiffs: StateDiff[];
  reportPath: string;
  pass: boolean;
}

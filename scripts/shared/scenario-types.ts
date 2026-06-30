/**
 * BlastSimulator2026 — Shared Scenario Types
 *
 * Canonical type definitions for scenario steps, interaction actions,
 * and scenario definitions. Used by:
 *   - scripts/scenario-test.ts
 *   - scripts/convert-scenarios.ts
 *   - tests/unit/scenario-defs.test.ts
 *
 * @module shared/scenario-types
 */

/**
 * A single interaction action within a scenario step.
 * Covers all supported Puppeteer interaction types.
 */
export type InteractionStepAction =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'mousedown'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'mouseup'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'keypress'; key: string }
  | { type: 'keydown'; key: string }
  | { type: 'keyup'; key: string }
  | { type: 'scroll'; x: number; y: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; deltaZ: number }
  | { type: 'wait'; durationMs: number }
  | { type: 'waitForSelector'; selector: string; timeout?: number }
  | { type: 'type'; selector: string; text: string; delay?: number }
  | { type: 'assert'; selector?: string; property?: string; expectedValue?: unknown }
  | { type: 'viewport'; width: number; height: number }
  | { type: 'command'; command: string };

/**
 * A scenario step — either a legacy string command or an object with
 * command + optional interaction array for dual-play support.
 */
export type ScenarioStep = string | ScenarioStepDef;

/**
 * Object form of a scenario step with command and optional interaction array.
 */
export interface ScenarioStepDef {
  command: string;
  timeout?: number;
  description?: string;
  frames?: number;
  interval?: number;
  interaction?: InteractionStepAction[];
}

/**
 * Top-level scenario definition loaded from JSON files.
 */
export interface ScenarioDef {
  name: string;
  description: string;
  steps: Array<string | ScenarioStepDef>;
  shots?: Array<{ name: string; yaw: number; pitch: number }>;
}

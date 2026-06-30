/**
 * BlastSimulator2026 — Shared Interaction Executor
 *
 * Executes a single interaction action on a Puppeteer page.
 * Shared by scenario-test module for executing interaction actions
 * in dual-play mode (interaction execution path).
 *
 * @module shared/interaction-executor
 */

import type puppeteer from 'puppeteer';

/**
 * A minimal action type that covers all supported interaction types.
 * Both InteractionStepAction and InteractionRecordEvent are compatible
 * with this interface.
 */
export interface InteractionAction {
  type: string;
  x?: number;
  y?: number;
  button?: string;
  key?: string;
  selector?: string;
  text?: string;
  delay?: number;
  durationMs?: number;
  deltaX?: number;
  deltaY?: number;
  width?: number;
  height?: number;
  command?: string;
  timeout?: number;
  property?: string;
  expectedValue?: unknown;
  [key: string]: unknown;
}

/** Maps button names to Puppeteer MouseButton values. */
const BUTTON_MAP: Record<string, 'left' | 'right' | 'middle'> = {
  left: 'left',
  right: 'right',
  middle: 'middle',
};

/**
 * Executes a single interaction action on the given Puppeteer page.
 * Handles all supported action types: click, mousedown, mouseup, mousemove,
 * keypress, keydown, keyup, scroll, wheel, wait, waitForSelector, type,
 * assert, viewport, command.
 *
 * @param page - Puppeteer page object.
 * @param action - The interaction action to execute.
 */
export async function executeActionOnPage(
  page: puppeteer.Page,
  action: InteractionAction,
): Promise<void> {
  switch (action.type) {
    case 'click': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      await page.mouse.click(action.x!, action.y!, { button: btn });
      break;
    }
    case 'mousedown': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      await page.mouse.down({ button: btn });
      break;
    }
    case 'mouseup': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      await page.mouse.up({ button: btn });
      break;
    }
    case 'mousemove':
      await page.mouse.move(action.x!, action.y!);
      break;
    case 'keypress':
      await page.keyboard.press(action.key!);
      break;
    case 'keydown':
      await page.keyboard.down(action.key!);
      break;
    case 'keyup':
      await page.keyboard.up(action.key!);
      break;
    case 'scroll':
      await page.evaluate(
        ({ x, y }: { x: number; y: number }) => window.scrollTo(x, y),
        { x: action.x!, y: action.y! },
      );
      break;
    case 'wheel':
      await page.mouse.wheel({ deltaX: action.deltaX!, deltaY: action.deltaY! });
      break;
    case 'wait':
      await new Promise((r) => setTimeout(r, action.durationMs));
      break;
    case 'waitForSelector':
      await page.waitForSelector(action.selector!, { timeout: action.timeout ?? 10000 });
      break;
    case 'type':
      await page.type(action.selector!, action.text!, { delay: action.delay });
      break;
    case 'assert': {
      if (action.selector) {
        const element = await page.$(action.selector);
        if (!element) {
          console.warn(`  Assert FAILED: selector "${action.selector}" not found`);
        } else if (action.property && action.expectedValue !== undefined) {
          const actual = await element.evaluate(
            (el: Element, prop: string) => (el as any)[prop],
            action.property,
          );
          const passed = JSON.stringify(actual) === JSON.stringify(action.expectedValue);
          if (!passed) {
            console.warn(`  Assert FAILED: expected ${action.property}=${JSON.stringify(action.expectedValue)}, got ${JSON.stringify(actual)}`);
          }
        }
      }
      break;
    }
    case 'viewport':
      await page.setViewport({ width: action.width!, height: action.height! });
      break;
    case 'command':
      await page.evaluate((cmd: string) => {
        if (typeof (window as any).__gameConsole === 'function') {
          return (window as any).__gameConsole(cmd);
        }
        return undefined;
      }, action.command!);
      break;
    default:
      console.warn(`  Unknown interaction action type: ${action.type}`);
      break;
  }
}

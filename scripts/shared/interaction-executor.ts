/**
 * BlastSimulator2026 — Shared Interaction Executor
 *
 * Executes a single interaction action on a Puppeteer page.
 * Shared by scenario-test module for executing interaction actions
 * in dual-play mode (interaction execution path).
 *
 * @module shared/interaction-executor
 */

import type { Page, KeyInput } from 'puppeteer';
import type { InteractionStepAction } from './scenario-types.js';

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
  page: Page,
  action: InteractionStepAction,
): Promise<void> {
  switch (action.type) {
    case 'click': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      await page.mouse.click(action.x, action.y, { button: btn });
      break;
    }
    case 'clickSelector': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      await page.waitForSelector(action.selector, { timeout: action.timeout ?? 5000 });
      await page.click(action.selector, { button: btn });
      break;
    }
    case 'mousedown': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      // The action carries coordinates, so honour them rather than pressing
      // wherever the cursor happens to be.
      await page.mouse.move(action.x, action.y);
      await page.mouse.down({ button: btn });
      break;
    }
    case 'mouseup': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      await page.mouse.move(action.x, action.y);
      await page.mouse.up({ button: btn });
      break;
    }
    case 'mousemove':
      await page.mouse.move(action.x, action.y);
      break;
    case 'keypress':
      await page.keyboard.press(action.key as KeyInput);
      break;
    case 'keydown':
      await page.keyboard.down(action.key as KeyInput);
      break;
    case 'keyup':
      await page.keyboard.up(action.key as KeyInput);
      break;
    case 'scroll':
      await page.evaluate(
        ({ x, y }: { x: number; y: number }) => window.scrollTo(x, y),
        { x: action.x, y: action.y },
      );
      break;
    case 'wheel':
      await page.mouse.wheel({ deltaX: action.deltaX, deltaY: action.deltaY });
      break;
    case 'wait':
      await new Promise((r) => setTimeout(r, action.durationMs));
      break;
    case 'waitForSelector':
      await page.waitForSelector(action.selector, { timeout: action.timeout ?? 10000 });
      break;
    case 'type':
      await page.type(action.selector, action.text, {
        ...(action.delay !== undefined ? { delay: action.delay } : {}),
      });
      break;
    case 'assert': {
      if (action.selector) {
        const element = await page.$(action.selector);
        if (!element) {
          throw new Error(`Assert FAILED: selector "${action.selector}" not found`);
        } else if (action.property && action.expectedValue !== undefined) {
          const actual = await element.evaluate(
            (el: Element, prop: string) => (el as unknown as Record<string, unknown>)[prop],
            action.property,
          );
          const passed = JSON.stringify(actual) === JSON.stringify(action.expectedValue);
          if (!passed) {
            throw new Error(`Assert FAILED: expected ${action.property}=${JSON.stringify(action.expectedValue)}, got ${JSON.stringify(actual)}`);
          }
        }
      }
      break;
    }
    case 'viewport':
      await page.setViewport({ width: action.width, height: action.height });
      break;
    case 'command':
      await page.evaluate((cmd: string) => {
        if (typeof (window as any).__gameConsole === 'function') {
          return (window as any).__gameConsole(cmd);
        }
        return undefined;
      }, action.command);
      break;
    case 'screenshot':
      // Screenshot is handled by the caller, not here
      break;
    default: {
      // Exhaustiveness check
      const _exhaustive: never = action;
      console.warn(`  Unknown interaction action type: ${(_exhaustive as any).type}`);
      break;
    }
  }
}

/**
 * BlastSimulator2026 — Accessibility (a11y) Color Contrast Checker
 *
 * Opens the game in headless Chrome, extracts all visible text elements
 * with their computed foreground and background colors, and reports WCAG
 * AA/AAA contrast ratio failures.
 *
 * Usage:
 *   npx tsx scripts/a11y-check.ts
 *   npx tsx scripts/a11y-check.ts --port 5174
 *   npx tsx scripts/a11y-check.ts --viewport "1920x1080"
 *
 * Output: screenshots/a11y/report.json
 *
 * WCAG thresholds:
 *   AA normal text: 4.5:1
 *   AA large text (>=18pt or >=14pt bold): 3:1
 *   AAA normal text: 7:1
 *   AAA large text: 4.5:1
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { initBrowser } from './shared/puppeteer-utils.js';
import { analyzeElement, parseRgba, type RawElement, type TextElement } from './shared/a11y-contrast.js';
import {
  A11Y_PANELS, assertRegionsPopulated, closePanelViaRail, openPanelViaRail, startGame,
  type A11yPage,
} from './shared/a11y-setup.js';

interface UnresolvedElement { tag: string; text: string; region: string }

interface A11yReport {
  url: string;
  viewport: string;
  timestamp: string;
  totalElements: number;
  failures: TextElement[];
  unresolvedBackground: UnresolvedElement[];
  /** Elements actually judged (resolved background) per region. */
  regionCounts: Record<string, number>;
  passCount: number;
  failCount: number;
  summary: string;
}

/**
 * esbuild (via tsx) rewrites named functions to `__name(fn, "fn")`. That helper
 * is module-scoped in Node and does not travel with a serialized page.evaluate
 * body, so any helper function declared in a page function would throw
 * "__name is not defined" in the browser. An identity shim installed as a raw
 * string stays out of esbuild's reach.
 */
const NAME_SHIM = 'globalThis.__name = globalThis.__name || function (fn) { return fn; }';

const TOP_BAR = 'TopBar';
const TOOL_RAIL = 'ToolRail';
const REGION_ROOTS: Readonly<Record<string, string>> = { [TOP_BAR]: '#bs-hud-top', [TOOL_RAIL]: '#bs-toolbar' };
/** Failure lines printed per region before eliding the rest. */
const PRINT_CAP_PER_REGION = 15;

/**
 * In-page collection of visible text under `rootSelector`. Returns raw colour
 * strings and ancestor layers; no contrast logic runs here because a page
 * function cannot import (see `NAME_SHIM`).
 */
function collectRegion(rootSelector: string, region: string): RawElement[] {
  const root = document.querySelector(rootSelector);
  if (!root) return [];
  const results: RawElement[] = [];
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  all.forEach(el => {
    const ownText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent ?? '')
      .join('')
      .trim();
    if (!ownText) return;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    if (parseFloat(style.opacity) === 0) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'canvas' || tag === 'script' || tag === 'style') return;
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const layers: string[] = [];
    let node: Element | null = el;
    while (node) {
      layers.push(window.getComputedStyle(node).backgroundColor);
      node = node.parentElement;
    }
    results.push({
      tag, text: ownText.substring(0, 100), region,
      fontSize: style.fontSize, fontWeight: style.fontWeight,
      color: style.color, layers,
    });
  });
  return results;
}

function parseArgs(): { port: number; viewport: { width: number; height: number } } {
  const args = process.argv.slice(2);
  let port = 5173;
  let viewport = { width: 1280, height: 720 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--viewport' && args[i + 1]) {
      const viewportStr = args[i + 1]!;
      const parts = viewportStr.split('x').map(v => parseInt(v, 10));
      if (parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
        viewport = { width: parts[0]!, height: parts[1]! };
      }
      i++;
    }
  }

  return { port, viewport };
}

async function runA11yCheck(port: number, viewport: { width: number; height: number }): Promise<A11yReport> {
  const devServerUrl = `http://localhost:${port}`;
  const { browser, page } = await initBrowser({ port, viewport });

  try {
    await page.evaluate(NAME_SHIM);

    // Real UI: start a staffed game, then drive panels through the tool rail.
    const a11yPage = page as unknown as A11yPage;
    await startGame(a11yPage);
    await page.evaluate(NAME_SHIM);
    // Tutorial overlay would cover and pollute the measured UI.
    await page.evaluate("localStorage.setItem('bs_tutorial_done', '1'); document.getElementById('bs-tutorial-overlay')?.remove();");

    const raw: RawElement[] = [];
    const measure = async (rootSelector: string, region: string): Promise<void> => {
      raw.push(...await page.evaluate(collectRegion, rootSelector, region));
    };

    await measure(REGION_ROOTS[TOP_BAR]!, TOP_BAR);
    await measure(REGION_ROOTS[TOOL_RAIL]!, TOOL_RAIL);
    for (const { rail, panelId } of A11Y_PANELS) {
      await openPanelViaRail(a11yPage, rail, panelId);
      await new Promise(r => setTimeout(r, 300));
      await measure(`#${panelId}`, panelId);
      await closePanelViaRail(a11yPage, rail, panelId);
    }

    const failures: TextElement[] = [];
    const unresolvedBackground: UnresolvedElement[] = [];
    const regionCounts: Record<string, number> = {};
    let measured = 0;
    for (const el of raw) {
      const analyzed = analyzeElement(el);
      if (!analyzed) {
        if (parseRgba(el.color)?.[3] !== 0) unresolvedBackground.push({ tag: el.tag, text: el.text, region: el.region });
        continue;
      }
      measured++;
      regionCounts[el.region] = (regionCounts[el.region] ?? 0) + 1;
      if (!analyzed.wcagAANormal) failures.push(analyzed);
    }
    // Count judged elements only: a region whose every element had an
    // unresolvable background must fail the run, not pass silently.
    assertRegionsPopulated(regionCounts, [TOP_BAR, TOOL_RAIL, ...A11Y_PANELS.map(p => p.panelId)]);

    const unresolvedNote = unresolvedBackground.length > 0
      ? ` ${unresolvedBackground.length} element(s) had no opaque background and were not judged.`
      : '';
    const report: A11yReport = {
      url: devServerUrl,
      viewport: `${viewport.width}x${viewport.height}`,
      timestamp: new Date().toISOString(),
      totalElements: raw.length,
      failures,
      unresolvedBackground,
      regionCounts,
      passCount: measured - failures.length,
      failCount: failures.length,
      summary: failures.length === 0
        ? `PASS: ${measured} measured elements meet WCAG AA normal contrast (4.5:1).${unresolvedNote}`
        : `FAIL: ${failures.length}/${measured} measured elements below WCAG AA normal contrast threshold (4.5:1).${unresolvedNote}`,
    };

    const outDir = resolve(process.cwd(), 'screenshots/a11y');
    mkdirSync(outDir, { recursive: true });
    const reportPath = resolve(outDir, 'report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`A11y report saved: ${reportPath}`);

    return report;
  } finally {
    await browser.close();
  }
}

/** Print every region's failures, capped per region so one noisy panel cannot hide another. */
function printFailures(failures: readonly TextElement[]): void {
  const byRegion = new Map<string, TextElement[]>();
  for (const f of failures) byRegion.set(f.region, [...(byRegion.get(f.region) ?? []), f]);
  for (const [region, list] of byRegion) {
    console.log(`  ${region}: ${list.length} failure(s)`);
    for (const f of list.slice(0, PRINT_CAP_PER_REGION)) {
      console.log(`    [${f.tag}] "${f.text.substring(0, 40)}" — ratio ${f.contrastRatio}:1, fg=${f.foreground} bg=${f.background}`);
    }
    if (list.length > PRINT_CAP_PER_REGION) console.log(`    ... ${list.length - PRINT_CAP_PER_REGION} more (see report.json)`);
  }
}

function main(): void {
  const { port, viewport } = parseArgs();
  runA11yCheck(port, viewport)
    .then(report => {
      console.log(report.summary);
      console.log(`Unresolved backgrounds: ${report.unresolvedBackground.length}`);
      if (report.failCount > 0) {
        console.log('Failures by region:');
        printFailures(report.failures);
        process.exit(1);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('A11y check failed:', err);
      process.exit(1);
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

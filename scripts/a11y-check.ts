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

import puppeteer from 'puppeteer';
import type { PuppeteerLaunchOptions } from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './shared/chrome.js';

interface TextElement {
  tag: string;
  text: string;
  fontSize: string;
  fontWeight: string;
  foreground: string;
  background: string;
  contrastRatio: number;
  wcagAALarge: boolean;
  wcagAANormal: boolean;
  wcagAAALarge: boolean;
  wcagAAANormal: boolean;
}

interface A11yReport {
  url: string;
  viewport: string;
  timestamp: string;
  totalElements: number;
  failures: TextElement[];
  passCount: number;
  failCount: number;
  summary: string;
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linearize = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Normalise a colour to hex. The in-page pass already composites alpha and
 * emits hex, so accept that form unchanged; the rgb() form remains supported
 * for any caller that has not been through compositing.
 */
function rgbToHex(rgb: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(rgb)) return rgb.toLowerCase();
  const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  const r = parseInt(match[1]!).toString(16).padStart(2, '0');
  const g = parseInt(match[2]!).toString(16).padStart(2, '0');
  const b = parseInt(match[3]!).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
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

  const launchOptions: PuppeteerLaunchOptions = {
    headless: true,
    args: LAUNCH_ARGS,
    executablePath: resolveChromePathOrThrow(),
  };

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);

    console.log(`Navigating to ${devServerUrl}...`);
    // See puppeteer-utils.ts's initBrowser() for why this isn't
    // 'networkidle0' (#458 T5.1 — EffectComposer/OutputPass regression).
    await page.goto(devServerUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));

    // Dismiss main menu
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });

    // Reveal every panel. Controls inside a closed panel measure zero-size and
    // would be skipped, leaving most of the UI's text unchecked.
    const panelsShown = await page.evaluate(() => {
      const ids = ['bs-blast-panel', 'bs-contract-panel', 'bs-build-panel',
        'bs-vehicle-panel', 'bs-employee-panel', 'bs-survey-panel',
        'bs-selection-bar']; // scene selection bar (redesign P2) — hidden until a scene entity is selected
      let shown = 0;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          (el as HTMLElement).style.display = 'block';
          shown++;
        }
      }
      return shown;
    });
    console.log(`Panels revealed for measurement: ${panelsShown}`);
    await new Promise(r => setTimeout(r, 500));

    // esbuild (via tsx) rewrites named functions to `__name(fn, "fn")` to
    // preserve Function.name. That helper is module-scoped in Node and does not
    // travel with a serialized page.evaluate body, so any helper function
    // declared below would throw "__name is not defined" in the browser.
    // Installing an identity shim as a raw string keeps it out of esbuild's reach.
    await page.evaluate('globalThis.__name = globalThis.__name || function (fn) { return fn; }');

    // Extract all visible text elements with computed styles
    const elements: TextElement[] = await page.evaluate(() => {
      const allElements = document.querySelectorAll('body *');
      const results: any[] = [];

      // NOTE: function declarations, not arrow consts. esbuild (via tsx)
      // annotates named function expressions with a `__name()` helper that does
      // not exist in the page, and the evaluate call dies with
      // "__name is not defined".

      /** Parse any CSS color the browser computed into RGBA components. */
      function parseRgba(css: string): [number, number, number, number] | null {
        const m = css.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
        if (!m) return null;
        return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]!];
      }

      /** Composite a translucent colour over an already-opaque backdrop. */
      function composite(
        fg: [number, number, number, number],
        bg: [number, number, number],
      ): [number, number, number] {
        return [
          Math.round(fg[0] * fg[3] + bg[0] * (1 - fg[3])),
          Math.round(fg[1] * fg[3] + bg[1] * (1 - fg[3])),
          Math.round(fg[2] * fg[3] + bg[2] * (1 - fg[3])),
        ];
      }

      /**
       * Effective background behind an element. An element's own
       * background-color is frequently transparent or semi-transparent, so the
       * ancestor chain has to be composited to find what the text actually sits
       * on. Reading backgroundColor alone reports translucent white panels as
       * solid #ffffff and invents contrast failures that are not on screen.
       */
      function effectiveBackground(start: Element): [number, number, number] {
        const layers: [number, number, number, number][] = [];
        let node: Element | null = start;

        while (node) {
          const parsed = parseRgba(window.getComputedStyle(node).backgroundColor);
          if (parsed && parsed[3] > 0) {
            layers.push(parsed);
            if (parsed[3] === 1) break;
          }
          node = node.parentElement;
        }

        // Canvas-backed game: anything still unresolved sits on the page canvas.
        let base: [number, number, number] = [255, 255, 255];
        for (let i = layers.length - 1; i >= 0; i--) {
          base = composite(layers[i]!, base);
        }
        return base;
      }

      function toHex(c: [number, number, number]): string {
        return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
      }

      allElements.forEach(el => {
        // Only elements holding their own text — innerText includes descendants,
        // so containers would re-report their children's text with the
        // container's colours.
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

        const fg = parseRgba(style.color);
        if (!fg || fg[3] === 0) return;

        const bg = effectiveBackground(el);

        results.push({
          tag,
          text: ownText.substring(0, 100),
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          // Text alpha composites against its own backdrop too.
          foreground: toHex(fg[3] < 1 ? composite(fg, bg) : [fg[0], fg[1], fg[2]]),
          background: toHex(bg),
        });
      });

      return results;
    });

    // Analyze contrast
    const failures: TextElement[] = [];
    for (const el of elements) {
      const fgHex = rgbToHex(el.foreground);
      const bgHex = rgbToHex(el.background);
      if (!fgHex || !bgHex) continue;

      const ratio = contrastRatio(fgHex, bgHex);

      const passAANormal = ratio >= 4.5;
      const passAALarge = ratio >= 3.0;
      const passAAANormal = ratio >= 7.0;
      const passAAALarge = ratio >= 4.5;

      const element: TextElement = {
        tag: el.tag,
        text: el.text,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        foreground: fgHex,
        background: bgHex,
        contrastRatio: Math.round(ratio * 100) / 100,
        wcagAALarge: passAALarge,
        wcagAANormal: passAANormal,
        wcagAAALarge: passAAALarge,
        wcagAAANormal: passAAANormal,
      };

      // Fail if it doesn't meet AA normal (most common standard)
      if (!passAANormal) {
        failures.push(element);
      }
    }

    const report: A11yReport = {
      url: devServerUrl,
      viewport: `${viewport.width}x${viewport.height}`,
      timestamp: new Date().toISOString(),
      totalElements: elements.length,
      failures,
      passCount: elements.length - failures.length,
      failCount: failures.length,
      summary: failures.length === 0
        ? `PASS: All ${elements.length} elements meet WCAG AA normal contrast (4.5:1).`
        : `FAIL: ${failures.length}/${elements.length} elements below WCAG AA normal contrast threshold (4.5:1).`,
    };

    // Save report
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

const { port, viewport } = parseArgs();
runA11yCheck(port, viewport)
  .then(report => {
    console.log(report.summary);
    if (report.failCount > 0) {
      console.log(`First 5 failures:`);
      report.failures.slice(0, 5).forEach(f => {
        console.log(`  [${f.tag}] "${f.text.substring(0, 40)}" — ratio ${f.contrastRatio}:1, fg=${f.foreground} bg=${f.background}`);
      });
      process.exit(1);
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('A11y check failed:', err);
    process.exit(1);
  });

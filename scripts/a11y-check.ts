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
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

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

function isLargeText(fontSize: string, fontWeight: string): boolean {
  const size = parseFloat(fontSize);
  const bold = fontWeight === 'bold' || parseInt(fontWeight) >= 700;
  return size >= 18 || (size >= 14 && bold);
}

function rgbToHex(rgb: string): string | null {
  const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  const r = parseInt(match[1]).toString(16).padStart(2, '0');
  const g = parseInt(match[2]).toString(16).padStart(2, '0');
  const b = parseInt(match[3]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function parseArgs(): { port: number; viewport: { width: number; height: number } } {
  const args = process.argv.slice(2);
  let port = 5173;
  let viewport = { width: 1280, height: 720 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--viewport' && args[i + 1]) {
      const parts = args[i + 1].split('x').map(v => parseInt(v, 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        viewport = { width: parts[0], height: parts[1] };
      }
      i++;
    }
  }

  return { port, viewport };
}

async function runA11yCheck(port: number, viewport: { width: number; height: number }): Promise<A11yReport> {
  const devServerUrl = `http://localhost:${port}`;

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);

    console.log(`Navigating to ${devServerUrl}...`);
    await page.goto(devServerUrl, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));

    // Dismiss main menu
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });
    await new Promise(r => setTimeout(r, 500));

    // Extract all visible text elements with computed styles
    const elements: TextElement[] = await page.evaluate(() => {
      const allElements = document.querySelectorAll('body *');
      const results: any[] = [];

      allElements.forEach(el => {
        const text = (el as HTMLElement).innerText?.trim();
        if (!text) return;

        const style = window.getComputedStyle(el);
        const display = style.display;
        const visibility = style.visibility;

        if (display === 'none' || visibility === 'hidden') return;

        const color = style.color;
        const bg = style.backgroundColor;
        const fontSize = style.fontSize;
        const fontWeight = style.fontWeight;

        if (!color || !bg) return;
        if (color === 'rgba(0, 0, 0, 0)' || bg === 'rgba(0, 0, 0, 0)') return;

        // Skip canvas and script elements
        const tag = el.tagName.toLowerCase();
        if (tag === 'canvas' || tag === 'script' || tag === 'style') return;

        results.push({
          tag,
          text: text.substring(0, 100), // truncate long text
          fontSize,
          fontWeight,
          foreground: color,
          background: bg,
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
      const large = isLargeText(el.fontSize, el.fontWeight);

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

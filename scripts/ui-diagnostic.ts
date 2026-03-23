/**
 * BlastSimulator2026 — UI Button Diagnostic
 *
 * Opens the game, creates holes, opens the blast panel via UI click,
 * and checks the responsiveness of all blast panel buttons.
 */

import puppeteer from 'puppeteer';
import { mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const DEV_SERVER_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 720 };
const INIT_WAIT_MS = 3000;
const SCREENSHOTS_DIR = resolve(process.cwd(), 'screenshots/ui-diagnostic');

async function run() {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const CHROMIUM_PATHS = [
    '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const executablePath = CHROMIUM_PATHS.find(p => existsSync(p));

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(DEV_SERVER_URL, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
    await new Promise(r => setTimeout(r, INIT_WAIT_MS));

    // Dismiss main menu
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });
    await new Promise(r => setTimeout(r, 500));

    // Step 1: Create game + drill holes via console
    console.log('=== Setting up game state ===');
    const out1 = await page.evaluate(() => (window as any).__gameConsole('new_game seed:42'));
    console.log('new_game:', out1);
    const out2 = await page.evaluate(() => (window as any).__gameConsole('drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15'));
    console.log('drill_plan:', out2);
    await new Promise(r => setTimeout(r, 500));

    // Step 2: Take screenshot before opening blast panel
    await page.screenshot({ path: resolve(SCREENSHOTS_DIR, '01-before-panel.png') });

    // Step 3: Click the "Blast" toolbar button
    console.log('\n=== Clicking Blast toolbar button ===');
    const toolbarBtns = await page.$$('#bs-toolbar button');
    let blastBtnFound = false;
    for (const btn of toolbarBtns) {
      const text = await btn.evaluate(el => el.textContent);
      console.log(`  Toolbar button: "${text}"`);
      if (text && text.includes('Blast')) {
        await btn.click();
        blastBtnFound = true;
        console.log('  -> Clicked!');
        break;
      }
    }
    if (!blastBtnFound) {
      console.log('  WARNING: Blast button not found in toolbar!');
    }
    await new Promise(r => setTimeout(r, 500));

    // Step 4: Screenshot with panel open
    await page.screenshot({ path: resolve(SCREENSHOTS_DIR, '02-panel-open.png') });

    // Step 5: Check UI state
    const uiState = await page.evaluate(() => (window as any).__uiState());
    console.log('\n=== UI State ===');
    console.log(JSON.stringify(uiState, null, 2));

    // Step 6: Check blast panel visibility and buttons
    const blastPanelInfo = await page.evaluate(() => {
      const panel = document.getElementById('bs-blast-panel');
      if (!panel) return { exists: false };

      const computed = getComputedStyle(panel);
      const buttons: any[] = [];
      panel.querySelectorAll('button').forEach(btn => {
        const btnComputed = getComputedStyle(btn);
        buttons.push({
          text: btn.textContent,
          className: btn.className,
          display: btnComputed.display,
          visibility: btnComputed.visibility,
          pointerEvents: btnComputed.pointerEvents,
          disabled: btn.disabled,
          width: btn.offsetWidth,
          height: btn.offsetHeight,
          rect: btn.getBoundingClientRect().toJSON(),
        });
      });

      // Check parent chain pointer-events
      const parentChain: any[] = [];
      let el: HTMLElement | null = panel;
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        parentChain.push({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          pointerEvents: cs.pointerEvents,
          display: cs.display,
          zIndex: cs.zIndex,
        });
        el = el.parentElement;
      }

      // Check hole rows
      const holeRows = panel.querySelectorAll('.bs-hole-row');
      const holes: any[] = [];
      holeRows.forEach(row => {
        const id = row.querySelector('.bs-hole-id')?.textContent;
        const editBtn = row.querySelector('button');
        holes.push({
          id,
          editBtnText: editBtn?.textContent,
          editBtnClickable: editBtn ? getComputedStyle(editBtn).pointerEvents : 'N/A',
        });
      });

      return {
        exists: true,
        display: computed.display,
        pointerEvents: computed.pointerEvents,
        buttons,
        parentChain,
        holes,
        chargeFormDisplay: panel.querySelector('.bs-hole-id-label')?.parentElement ?
          getComputedStyle(panel.querySelector('.bs-hole-id-label')!.parentElement!).display : 'N/A',
      };
    });

    console.log('\n=== Blast Panel Info ===');
    console.log(JSON.stringify(blastPanelInfo, null, 2));

    // Step 7: Try clicking "Edit" button on first hole
    if (blastPanelInfo.exists && blastPanelInfo.holes?.length > 0) {
      console.log('\n=== Clicking Edit on first hole ===');
      const editClicked = await page.evaluate(() => {
        const panel = document.getElementById('bs-blast-panel');
        if (!panel) return false;
        const editBtns = panel.querySelectorAll('.bs-hole-row button');
        if (editBtns.length > 0) {
          (editBtns[0] as HTMLButtonElement).click();
          return true;
        }
        return false;
      });
      console.log('Edit button clicked:', editClicked);
      await new Promise(r => setTimeout(r, 300));

      // Check charge form visibility
      const chargeFormVisible = await page.evaluate(() => {
        const panel = document.getElementById('bs-blast-panel');
        if (!panel) return false;
        const label = panel.querySelector('.bs-hole-id-label');
        if (!label || !label.parentElement) return false;
        return {
          display: label.parentElement.style.display,
          labelText: label.textContent,
        };
      });
      console.log('Charge form state after edit click:', JSON.stringify(chargeFormVisible));

      await page.screenshot({ path: resolve(SCREENSHOTS_DIR, '03-after-edit-click.png') });
    }

    // Step 8: Try clicking Auto Sequence button directly
    console.log('\n=== Clicking Auto Sequence button ===');
    const seqResult = await page.evaluate(() => {
      const panel = document.getElementById('bs-blast-panel');
      if (!panel) return 'panel not found';
      const buttons = panel.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent && (btn.textContent.includes('Auto') || btn.textContent.includes('Sequence') || btn.textContent.includes('seq'))) {
          btn.click();
          return `Clicked: "${btn.textContent}"`;
        }
      }
      return 'Auto Sequence button not found. All buttons: ' +
        Array.from(buttons).map(b => `"${b.textContent}"`).join(', ');
    });
    console.log('Result:', seqResult);
    await new Promise(r => setTimeout(r, 500));

    // Check if sequence was applied
    const stateAfterSeq = await page.evaluate(() => (window as any).__gameState());
    console.log('State after seq click - sequenced:', stateAfterSeq?.sequencedCount);

    await page.screenshot({ path: resolve(SCREENSHOTS_DIR, '04-after-seq-click.png') });

    console.log('\nDiagnostic complete. Screenshots in:', SCREENSHOTS_DIR);
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});

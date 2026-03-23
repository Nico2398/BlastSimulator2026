/**
 * BlastSimulator2026 — Exhaustive UI Button Diagnostic
 *
 * Opens the game, sets up state, then systematically clicks EVERY interactive
 * UI element across all panels and toolbar buttons. Reports which buttons
 * respond vs. which are broken (zero-size, pointer-events:none, etc.).
 *
 * Output: screenshots/ui-diagnostic/ with per-panel screenshots + summary.
 */

import puppeteer, { type Page } from 'puppeteer';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DEV_SERVER_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 720 };
const INIT_WAIT_MS = 3000;
const SCREENSHOTS_DIR = resolve(process.cwd(), 'screenshots/ui-diagnostic');

// ── Result tracking ──

interface ButtonResult {
  panel: string;
  text: string;
  width: number;
  height: number;
  pointerEvents: string;
  display: string;
  disabled: boolean;
  clickable: boolean;
  issue?: string;
}

const results: ButtonResult[] = [];
let screenshotIdx = 0;

function logResult(r: ButtonResult): void {
  results.push(r);
  const status = r.clickable ? 'OK' : `BROKEN (${r.issue})`;
  console.log(`  [${status}] "${r.text}" (${r.width}x${r.height})`);
}

async function screenshot(page: Page, label: string): Promise<void> {
  const idx = String(screenshotIdx++).padStart(2, '0');
  const slug = label.replace(/[^a-z0-9_-]/gi, '_').substring(0, 40);
  await page.screenshot({ path: resolve(SCREENSHOTS_DIR, `${idx}-${slug}.png`) });
}

// ── Audit all buttons in a panel ──

async function auditPanelButtons(page: Page, panelId: string, panelName: string): Promise<void> {
  const info = await page.evaluate((pid: string) => {
    const panel = document.getElementById(pid);
    if (!panel) return null;
    const cs = getComputedStyle(panel);
    const btns: any[] = [];
    panel.querySelectorAll('button').forEach(btn => {
      const bcs = getComputedStyle(btn);
      btns.push({
        text: (btn.textContent ?? '').trim().substring(0, 40),
        className: btn.className,
        width: btn.offsetWidth,
        height: btn.offsetHeight,
        display: bcs.display,
        visibility: bcs.visibility,
        pointerEvents: bcs.pointerEvents,
        disabled: btn.disabled,
        rect: btn.getBoundingClientRect().toJSON(),
      });
    });
    return {
      exists: true,
      display: cs.display,
      pointerEvents: cs.pointerEvents,
      buttonCount: btns.length,
      buttons: btns,
    };
  }, panelId);

  if (!info) {
    console.log(`  Panel #${panelId}: NOT FOUND`);
    results.push({
      panel: panelName,
      text: `(panel #${panelId} missing)`,
      width: 0, height: 0,
      pointerEvents: 'N/A', display: 'N/A',
      disabled: false, clickable: false,
      issue: 'panel element not found',
    });
    return;
  }

  if (info.display === 'none') {
    console.log(`  Panel #${panelId}: hidden (display:none) — ${info.buttonCount} buttons`);
    results.push({
      panel: panelName,
      text: `(panel #${panelId} hidden)`,
      width: 0, height: 0,
      pointerEvents: info.pointerEvents, display: info.display,
      disabled: false, clickable: false,
      issue: 'panel hidden',
    });
    return;
  }

  console.log(`  Panel #${panelId}: visible, ${info.buttonCount} buttons`);

  for (const btn of info.buttons) {
    let issue: string | undefined;
    if (btn.width === 0 || btn.height === 0) issue = 'zero-size';
    else if (btn.display === 'none') issue = 'display:none';
    else if (btn.visibility === 'hidden') issue = 'visibility:hidden';
    else if (btn.pointerEvents === 'none') issue = 'pointer-events:none';
    else if (btn.disabled) issue = 'disabled';

    logResult({
      panel: panelName,
      text: btn.text,
      width: btn.width,
      height: btn.height,
      pointerEvents: btn.pointerEvents,
      display: btn.display,
      disabled: btn.disabled,
      clickable: !issue,
      issue,
    });
  }
}

// ── Click a toolbar button by panel name ──

async function clickToolbarButton(page: Page, panelName: string): Promise<boolean> {
  const clicked = await page.evaluate((name: string) => {
    const toolbar = document.getElementById('bs-toolbar');
    if (!toolbar) return { clicked: false, error: 'toolbar not found' };
    const buttons = toolbar.querySelectorAll('button');
    for (const btn of buttons) {
      const dp = btn.getAttribute('data-panel');
      if (dp === name) {
        const cs = getComputedStyle(btn);
        const w = btn.offsetWidth;
        const h = btn.offsetHeight;
        btn.click();
        return {
          clicked: true,
          text: (btn.textContent ?? '').trim(),
          width: w,
          height: h,
          pointerEvents: cs.pointerEvents,
        };
      }
    }
    // Try matching by text content
    for (const btn of buttons) {
      if ((btn.textContent ?? '').toLowerCase().includes(name.toLowerCase())) {
        btn.click();
        return {
          clicked: true,
          text: (btn.textContent ?? '').trim(),
          width: btn.offsetWidth,
          height: btn.offsetHeight,
          pointerEvents: getComputedStyle(btn).pointerEvents,
        };
      }
    }
    return { clicked: false, error: `no button for panel "${name}"` };
  }, panelName);

  if (!clicked.clicked) {
    console.log(`  TOOLBAR: Could not click "${panelName}" — ${(clicked as any).error}`);
    return false;
  }
  console.log(`  TOOLBAR: Clicked "${(clicked as any).text}" (${(clicked as any).width}x${(clicked as any).height})`);
  return true;
}

// ── Main ──

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

    // ── Dismiss main menu ──
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });
    await new Promise(r => setTimeout(r, 500));

    // ── Set up game state ──
    console.log('=== Setting up game state ===');
    await page.evaluate(() => (window as any).__gameConsole('new_game seed:42'));
    await page.evaluate(() => (window as any).__gameConsole('drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15'));
    await page.evaluate(() => (window as any).__gameConsole('charge hole:* explosive:boomite amount:5 stemming:2'));
    await page.evaluate(() => (window as any).__gameConsole('tick 100'));
    await new Promise(r => setTimeout(r, 500));
    await screenshot(page, 'initial-state');

    // ══════════════════════════════════════════
    // 1. TOOLBAR BUTTONS — check every one exists, has size, is clickable
    // ══════════════════════════════════════════
    console.log('\n=== TOOLBAR BUTTONS ===');
    const toolbarInfo = await page.evaluate(() => {
      const toolbar = document.getElementById('bs-toolbar');
      if (!toolbar) return { exists: false, buttons: [] };
      const btns: any[] = [];
      toolbar.querySelectorAll('button').forEach(btn => {
        const cs = getComputedStyle(btn);
        btns.push({
          text: (btn.textContent ?? '').trim(),
          dataPanel: btn.getAttribute('data-panel'),
          width: btn.offsetWidth,
          height: btn.offsetHeight,
          display: cs.display,
          pointerEvents: cs.pointerEvents,
          disabled: btn.disabled,
        });
      });
      return { exists: true, buttons: btns };
    });

    if (!toolbarInfo.exists) {
      console.log('CRITICAL: #bs-toolbar not found!');
    } else {
      for (const btn of toolbarInfo.buttons) {
        let issue: string | undefined;
        if (btn.width === 0 || btn.height === 0) issue = 'zero-size';
        else if (btn.pointerEvents === 'none') issue = 'pointer-events:none';
        else if (btn.disabled) issue = 'disabled';
        logResult({
          panel: 'toolbar',
          text: btn.text,
          width: btn.width, height: btn.height,
          pointerEvents: btn.pointerEvents,
          display: btn.display,
          disabled: btn.disabled,
          clickable: !issue,
          issue,
        });
      }
    }

    // ══════════════════════════════════════════
    // 2. HUD — speed button
    // ══════════════════════════════════════════
    console.log('\n=== HUD SPEED BUTTON ===');
    const speedInfo = await page.evaluate(() => {
      const btn = document.querySelector('.bs-speed-btn') as HTMLButtonElement | null;
      if (!btn) return null;
      const cs = getComputedStyle(btn);
      const before = btn.textContent;
      btn.click();
      const after = btn.textContent;
      return {
        text: before,
        afterClick: after,
        changed: before !== after,
        width: btn.offsetWidth,
        height: btn.offsetHeight,
        pointerEvents: cs.pointerEvents,
      };
    });
    if (speedInfo) {
      const ok = speedInfo.changed && speedInfo.width > 0;
      logResult({
        panel: 'hud',
        text: `Speed: ${speedInfo.text} → ${speedInfo.afterClick}`,
        width: speedInfo.width, height: speedInfo.height,
        pointerEvents: speedInfo.pointerEvents,
        display: 'inline-block', disabled: false,
        clickable: ok,
        issue: ok ? undefined : (speedInfo.width === 0 ? 'zero-size' : 'text did not change after click'),
      });
    } else {
      logResult({
        panel: 'hud', text: '.bs-speed-btn',
        width: 0, height: 0, pointerEvents: 'N/A',
        display: 'N/A', disabled: false, clickable: false,
        issue: 'element not found',
      });
    }

    // ══════════════════════════════════════════
    // 3. BLAST PANEL — open and audit
    // ══════════════════════════════════════════
    console.log('\n=== BLAST PANEL ===');
    await clickToolbarButton(page, 'blast');
    await new Promise(r => setTimeout(r, 400));
    await screenshot(page, 'blast-panel');
    await auditPanelButtons(page, 'bs-blast-panel', 'blast');

    // Test specific blast interactions
    console.log('  -- Clicking edit on first hole:');
    const editResult = await page.evaluate(() => {
      const panel = document.getElementById('bs-blast-panel');
      if (!panel) return 'panel missing';
      const editBtns = panel.querySelectorAll('.bs-hole-row button');
      if (editBtns.length === 0) return 'no hole edit buttons';
      (editBtns[0] as HTMLButtonElement).click();
      const form = panel.querySelector('.bs-hole-id-label');
      return form ? `OK: charge form for ${form.textContent}` : 'FAIL: charge form not shown';
    });
    console.log(`     ${editResult}`);
    await new Promise(r => setTimeout(r, 300));
    await screenshot(page, 'blast-edit-hole');

    // Close blast panel
    await clickToolbarButton(page, 'blast');
    await new Promise(r => setTimeout(r, 200));

    // ══════════════════════════════════════════
    // 4. CONTRACT PANEL
    // ══════════════════════════════════════════
    console.log('\n=== CONTRACT PANEL ===');
    await clickToolbarButton(page, 'contracts');
    await new Promise(r => setTimeout(r, 400));
    await screenshot(page, 'contract-panel');
    await auditPanelButtons(page, 'bs-contract-panel', 'contracts');

    // Test accept button
    const acceptResult = await page.evaluate(() => {
      const panel = document.getElementById('bs-contract-panel');
      if (!panel) return 'panel missing';
      const acceptBtns = panel.querySelectorAll('button');
      for (const btn of acceptBtns) {
        if ((btn.textContent ?? '').toLowerCase().includes('accept')) {
          const w = btn.offsetWidth;
          const h = btn.offsetHeight;
          const pe = getComputedStyle(btn).pointerEvents;
          btn.click();
          return `Clicked accept (${w}x${h}, pe:${pe})`;
        }
      }
      return 'No accept button found';
    });
    console.log(`  Accept test: ${acceptResult}`);
    await new Promise(r => setTimeout(r, 300));

    await clickToolbarButton(page, 'contracts');
    await new Promise(r => setTimeout(r, 200));

    // ══════════════════════════════════════════
    // 5. BUILD PANEL
    // ══════════════════════════════════════════
    console.log('\n=== BUILD PANEL ===');
    await clickToolbarButton(page, 'build');
    await new Promise(r => setTimeout(r, 400));
    await screenshot(page, 'build-panel');
    await auditPanelButtons(page, 'bs-build-panel', 'build');

    await clickToolbarButton(page, 'build');
    await new Promise(r => setTimeout(r, 200));

    // ══════════════════════════════════════════
    // 6. VEHICLE PANEL
    // ══════════════════════════════════════════
    console.log('\n=== VEHICLE PANEL ===');
    await clickToolbarButton(page, 'vehicles');
    await new Promise(r => setTimeout(r, 400));
    await screenshot(page, 'vehicle-panel');
    await auditPanelButtons(page, 'bs-vehicle-panel', 'vehicles');

    // Test buy button
    const buyVehicle = await page.evaluate(() => {
      const panel = document.getElementById('bs-vehicle-panel');
      if (!panel) return 'panel missing';
      const btns = panel.querySelectorAll('button');
      for (const btn of btns) {
        if ((btn.textContent ?? '').toLowerCase().includes('buy') ||
            btn.getAttribute('data-vtype')) {
          const w = btn.offsetWidth;
          const h = btn.offsetHeight;
          const pe = getComputedStyle(btn).pointerEvents;
          return `Buy button found: "${(btn.textContent ?? '').trim()}" (${w}x${h}, pe:${pe})`;
        }
      }
      return 'No buy button found';
    });
    console.log(`  Buy test: ${buyVehicle}`);

    await clickToolbarButton(page, 'vehicles');
    await new Promise(r => setTimeout(r, 200));

    // ══════════════════════════════════════════
    // 7. EMPLOYEE PANEL
    // ══════════════════════════════════════════
    console.log('\n=== EMPLOYEE PANEL ===');
    await clickToolbarButton(page, 'employees');
    await new Promise(r => setTimeout(r, 400));
    await screenshot(page, 'employee-panel');
    await auditPanelButtons(page, 'bs-employee-panel', 'employees');

    // Test hire button
    const hireResult = await page.evaluate(() => {
      const panel = document.getElementById('bs-employee-panel');
      if (!panel) return 'panel missing';
      const btns = panel.querySelectorAll('button');
      for (const btn of btns) {
        if ((btn.textContent ?? '').toLowerCase().includes('hire') ||
            btn.getAttribute('data-role')) {
          const w = btn.offsetWidth;
          const h = btn.offsetHeight;
          const pe = getComputedStyle(btn).pointerEvents;
          btn.click();
          return `Clicked hire: "${(btn.textContent ?? '').trim()}" (${w}x${h}, pe:${pe})`;
        }
      }
      return 'No hire button found';
    });
    console.log(`  Hire test: ${hireResult}`);
    await new Promise(r => setTimeout(r, 300));

    // Verify employee was hired
    const empState = await page.evaluate(() => (window as any).__gameState());
    console.log(`  Employees after hire: ${empState?.employeeCount ?? 0}`);

    await clickToolbarButton(page, 'employees');
    await new Promise(r => setTimeout(r, 200));

    // ══════════════════════════════════════════
    // 8. SURVEY PANEL
    // ══════════════════════════════════════════
    console.log('\n=== SURVEY PANEL ===');
    await clickToolbarButton(page, 'survey');
    await new Promise(r => setTimeout(r, 400));
    await screenshot(page, 'survey-panel');
    await auditPanelButtons(page, 'bs-survey-panel', 'survey');

    await clickToolbarButton(page, 'survey');
    await new Promise(r => setTimeout(r, 200));

    // ══════════════════════════════════════════
    // 9. SETTINGS PANEL
    // ══════════════════════════════════════════
    console.log('\n=== SETTINGS PANEL ===');
    await clickToolbarButton(page, 'settings');
    await new Promise(r => setTimeout(r, 400));
    await screenshot(page, 'settings-panel');
    await auditPanelButtons(page, 'bs-settings-panel', 'settings');

    await clickToolbarButton(page, 'settings');
    await new Promise(r => setTimeout(r, 200));

    // ══════════════════════════════════════════
    // 10. EVENT DIALOG — trigger via pending event
    // ══════════════════════════════════════════
    console.log('\n=== EVENT DIALOG ===');
    const eventDialogInfo = await page.evaluate(() => {
      const overlay = document.querySelector('.bs-confirm-overlay') as HTMLElement | null;
      if (!overlay || overlay.style.display === 'none') return { visible: false };
      const btns: any[] = [];
      overlay.querySelectorAll('button').forEach(btn => {
        const cs = getComputedStyle(btn);
        btns.push({
          text: (btn.textContent ?? '').trim(),
          width: btn.offsetWidth,
          height: btn.offsetHeight,
          pointerEvents: cs.pointerEvents,
          disabled: btn.disabled,
        });
      });
      return { visible: true, buttons: btns };
    });

    if (eventDialogInfo.visible) {
      console.log(`  Event dialog visible with ${eventDialogInfo.buttons.length} buttons`);
      await screenshot(page, 'event-dialog');
      for (const btn of eventDialogInfo.buttons) {
        let issue: string | undefined;
        if (btn.width === 0 || btn.height === 0) issue = 'zero-size';
        else if (btn.pointerEvents === 'none') issue = 'pointer-events:none';
        logResult({
          panel: 'event-dialog',
          text: btn.text,
          width: btn.width, height: btn.height,
          pointerEvents: btn.pointerEvents,
          display: 'block', disabled: btn.disabled,
          clickable: !issue,
          issue,
        });
      }
    } else {
      console.log('  No event dialog visible (testing via console)');
      // Force an event to check dialog
      await page.evaluate(() => (window as any).__gameConsole('tick 200'));
      await new Promise(r => setTimeout(r, 500));

      const retryDialog = await page.evaluate(() => {
        const overlays = document.querySelectorAll('.bs-confirm-overlay');
        for (const overlay of overlays) {
          if ((overlay as HTMLElement).style.display !== 'none') {
            const btns: any[] = [];
            overlay.querySelectorAll('button').forEach(btn => {
              const cs = getComputedStyle(btn);
              btns.push({
                text: (btn.textContent ?? '').trim(),
                width: btn.offsetWidth,
                height: btn.offsetHeight,
                pointerEvents: cs.pointerEvents,
                disabled: btn.disabled,
              });
            });
            return { visible: true, buttons: btns };
          }
        }
        return { visible: false, buttons: [] };
      });

      if (retryDialog.visible) {
        console.log(`  Event dialog appeared with ${retryDialog.buttons.length} buttons`);
        await screenshot(page, 'event-dialog');
        for (const btn of retryDialog.buttons) {
          let issue: string | undefined;
          if (btn.width === 0 || btn.height === 0) issue = 'zero-size';
          else if (btn.pointerEvents === 'none') issue = 'pointer-events:none';
          logResult({
            panel: 'event-dialog',
            text: btn.text,
            width: btn.width, height: btn.height,
            pointerEvents: btn.pointerEvents,
            display: 'block', disabled: btn.disabled,
            clickable: !issue,
            issue,
          });
        }

        // Click first choice to dismiss
        await page.evaluate(() => {
          const overlays = document.querySelectorAll('.bs-confirm-overlay');
          for (const overlay of overlays) {
            if ((overlay as HTMLElement).style.display !== 'none') {
              const btn = overlay.querySelector('button');
              if (btn) btn.click();
              break;
            }
          }
        });
        await new Promise(r => setTimeout(r, 500));
        // Dismiss outcome dialog if present
        await page.evaluate(() => {
          const overlays = document.querySelectorAll('.bs-confirm-overlay');
          for (const overlay of overlays) {
            if ((overlay as HTMLElement).style.display !== 'none') {
              const btns = overlay.querySelectorAll('button');
              const last = btns[btns.length - 1];
              if (last) (last as HTMLButtonElement).click();
            }
          }
        });
        await new Promise(r => setTimeout(r, 300));
      } else {
        console.log('  No event triggered — skipping dialog test');
      }
    }

    // ══════════════════════════════════════════
    // 11. MAIN MENU BUTTONS
    // ══════════════════════════════════════════
    console.log('\n=== MAIN MENU ===');
    // Show main menu
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = '';
    });
    await new Promise(r => setTimeout(r, 300));
    await screenshot(page, 'main-menu');

    const menuInfo = await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (!menu) return { exists: false, buttons: [] };
      const btns: any[] = [];
      menu.querySelectorAll('button').forEach(btn => {
        const cs = getComputedStyle(btn);
        btns.push({
          text: (btn.textContent ?? '').trim(),
          width: btn.offsetWidth,
          height: btn.offsetHeight,
          display: cs.display,
          pointerEvents: cs.pointerEvents,
          disabled: btn.disabled,
        });
      });
      return { exists: true, buttons: btns };
    });

    for (const btn of menuInfo.buttons) {
      let issue: string | undefined;
      if (btn.width === 0 || btn.height === 0) issue = 'zero-size';
      else if (btn.display === 'none') issue = 'display:none';
      else if (btn.pointerEvents === 'none') issue = 'pointer-events:none';
      else if (btn.disabled) issue = 'disabled';
      logResult({
        panel: 'main-menu',
        text: btn.text,
        width: btn.width, height: btn.height,
        pointerEvents: btn.pointerEvents,
        display: btn.display,
        disabled: btn.disabled,
        clickable: !issue,
        issue,
      });
    }

    // Hide main menu again
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });
    await new Promise(r => setTimeout(r, 200));

    // ══════════════════════════════════════════
    // FINAL SUMMARY
    // ══════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    console.log('DIAGNOSTIC SUMMARY');
    console.log('═'.repeat(60));

    const ok = results.filter(r => r.clickable);
    const broken = results.filter(r => !r.clickable);

    console.log(`\nTotal buttons checked: ${results.length}`);
    console.log(`  OK:     ${ok.length}`);
    console.log(`  BROKEN: ${broken.length}`);

    if (broken.length > 0) {
      console.log('\n--- BROKEN BUTTONS ---');
      for (const r of broken) {
        console.log(`  [${r.panel}] "${r.text}" — ${r.issue} (${r.width}x${r.height})`);
      }
    }

    // Group by panel
    console.log('\n--- PER-PANEL RESULTS ---');
    const byPanel = new Map<string, ButtonResult[]>();
    for (const r of results) {
      if (!byPanel.has(r.panel)) byPanel.set(r.panel, []);
      byPanel.get(r.panel)!.push(r);
    }
    for (const [panel, panelResults] of byPanel) {
      const panelOk = panelResults.filter(r => r.clickable).length;
      const panelTotal = panelResults.length;
      console.log(`  ${panel}: ${panelOk}/${panelTotal} OK`);
    }

    // Write JSON report
    const reportPath = resolve(SCREENSHOTS_DIR, 'report.json');
    writeFileSync(reportPath, JSON.stringify({
      total: results.length,
      ok: ok.length,
      broken: broken.length,
      brokenDetails: broken,
      allResults: results,
    }, null, 2));
    console.log(`\nFull report: ${reportPath}`);
    console.log(`Screenshots: ${SCREENSHOTS_DIR}/`);

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});

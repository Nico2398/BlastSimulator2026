// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MainMenu } from '../../../src/ui/MainMenu.js';
import type { CampaignState } from '../../../src/core/campaign/Campaign.js';

function makeCampaign(): CampaignState {
  return {
    levels: {
      dusty_hollow: { unlocked: true, completed: true, bestSessionProfit: 160000 }, // > 80k threshold × 2
      grumpstone_ridge: { unlocked: true, completed: false, bestSessionProfit: 0 },
      treranium_depths: { unlocked: false, completed: false, bestSessionProfit: 0 },
    },
    currentLevelId: 'dusty_hollow',
    totalProfit: 160000,
  };
}

describe('MainMenu (12.8)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('is visible after show()', () => {
    const menu = new MainMenu(container);
    menu.show();
    expect(menu.visible).toBe(true);
    menu.dispose();
  });

  it('is hidden after hide()', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.hide();
    expect(menu.visible).toBe(false);
    menu.dispose();
  });

  it('calls onNewCampaign callback when button clicked', () => {
    const cb = vi.fn();
    const menu = new MainMenu(container);
    menu.setOnNewCampaign(cb);
    menu.show();
    // Find the New Campaign button (first primary button)
    const btn = container.querySelector('.bs-btn-primary') as HTMLButtonElement | null;
    btn?.click();
    expect(cb).toHaveBeenCalledOnce();
    menu.dispose();
  });

  it('calls onSettings callback when settings button clicked', () => {
    const cb = vi.fn();
    const menu = new MainMenu(container);
    menu.setOnSettings(cb);
    menu.show();
    // Find settings button by text content
    const buttons = Array.from(container.querySelectorAll('button'));
    const settingsBtn = buttons.find(b => b.textContent?.toLowerCase().includes('setting'));
    settingsBtn?.click();
    expect(cb).toHaveBeenCalledOnce();
    menu.dispose();
  });

  it('showWorldMap renders level cards', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(makeCampaign());
    // All 3 level names should appear in the rendered output
    const text = container.textContent ?? '';
    expect(text).toContain('Dusty Hollow');
    expect(text).toContain('Grumpstone Ridge');
    expect(text).toContain('Treranium Depths');
    menu.dispose();
  });

  it('showWorldMap shows locked indicator for locked level', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(makeCampaign());
    // Locked level should show 🔒
    expect(container.textContent).toContain('🔒');
    menu.dispose();
  });

  it('showWorldMap shows stars for completed level', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(makeCampaign());
    // Completed level should show star characters
    expect(container.textContent).toMatch(/★/);
    menu.dispose();
  });

  it('calls onStartLevel when level start button clicked', () => {
    const cb = vi.fn();
    const menu = new MainMenu(container);
    menu.setOnStartLevel(cb);
    menu.show();
    menu.showWorldMap(makeCampaign());
    // Find Start/Resume buttons by text content (world map level buttons)
    const allBtns = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    const startBtns = allBtns.filter(b =>
      b.textContent?.includes('Start') || b.textContent?.includes('Resume')
    );
    expect(startBtns.length).toBeGreaterThan(0);
    startBtns[0]?.click();
    expect(cb).toHaveBeenCalledOnce();
    menu.dispose();
  });

  it('dispose() removes overlay from container', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.dispose();
    expect(container.querySelector('#bs-main-menu')).toBeNull();
  });

  it('makeReturnToMapButton creates a button with click handler', () => {
    const cb = vi.fn();
    const menu = new MainMenu(container);
    const btn = menu.makeReturnToMapButton(document.body, cb);
    btn.click();
    expect(cb).toHaveBeenCalledOnce();
    menu.dispose();
  });
});

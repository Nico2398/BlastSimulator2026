// BlastSimulator2026 — Build Menu UI (10.4)
// Shows building catalog; clicking enters placement mode via console command.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { getAllBuildingTypes, getBuildingDef } from '../core/entities/Building.js';
import { TileSelectOverlay } from './TileSelectOverlay.js';

export type GameConsoleFn = (cmd: string) => string;

export class BuildMenu {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly tileSelect: TileSelectOverlay;
  private gameConsole?: GameConsoleFn;
  private worldSizeX = 40;
  private worldSizeZ = 40;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-build-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.build.title');

    this.listEl = document.createElement('div');

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size:10px;color:#a08060;margin-top:6px;min-height:14px';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    closeBtn.textContent = t('ui.build.close');
    closeBtn.addEventListener('click', () => this.hide());

    this.el.append(title, this.listEl, this.statusEl, closeBtn);
    container.appendChild(this.el);

    // TileSelectOverlay appended to document.body so it escapes panel stacking context
    this.tileSelect = new TileSelectOverlay(document.body);
    this.buildList();
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    if (state.world) {
      this.worldSizeX = state.world.sizeX;
      this.worldSizeZ = state.world.sizeZ;
    }
    const allTypes = getAllBuildingTypes();
    const rows = this.listEl.querySelectorAll('.bs-build-row');
    rows.forEach((row, i) => {
      const type = allTypes[i];
      if (!type) return;
      const def = getBuildingDef(type);
      const btn = row.querySelector('.bs-build-buy-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = state.cash < def.constructionCost;
    });
  }

  setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    setTimeout(() => { if (this.statusEl.textContent === msg) this.statusEl.textContent = ''; }, 3000);
  }

  dispose(): void { this.el.remove(); this.tileSelect.dispose(); }

  private buildList(): void {
    this.listEl.innerHTML = '';
    for (const type of getAllBuildingTypes()) {
      this.listEl.appendChild(this.makeBuildRow(type));
    }
  }

  private makeBuildRow(type: string): HTMLElement {
    const def = getBuildingDef(type as any);
    const row = document.createElement('div');
    row.className = 'bs-build-row';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';

    const name = document.createElement('div');
    name.style.cssText = 'font-size:11px;color:#d0b090;font-weight:bold';
    name.textContent = t(`building.${type}.name`);

    const cost = document.createElement('div');
    cost.style.cssText = 'font-size:10px;color:#a08060';
    cost.textContent = t('ui.build.cost', { cost: String(def.constructionCost) });

    info.append(name, cost);

    const btn = document.createElement('button');
    btn.className = 'bs-btn bs-btn-primary bs-build-buy-btn';
    btn.style.cssText = 'padding:2px 8px;font-size:10px;white-space:nowrap';
    btn.textContent = t('ui.build.place');
    btn.addEventListener('click', () => {
      this.tileSelect.open({
        mode: 'point',
        worldSizeX: this.worldSizeX,
        worldSizeZ: this.worldSizeZ,
        title: t(`building.${type}.name`),
        onConfirm: (result) => {
          this.gameConsole?.(`build place type:${type} x:${result.x} z:${result.z}`);
          this.setStatus(t('ui.build.placed'));
        },
      });
    });

    row.append(info, btn);
    return row;
  }
}

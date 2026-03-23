// BlastSimulator2026 — Blast Plan Editor UI (10.2)

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { DrillHole } from '../core/mining/DrillPlan.js';
import type { HoleCharge } from '../core/mining/ChargePlan.js';
import { TileSelectOverlay } from './TileSelectOverlay.js';

export type GameConsoleFn = (cmd: string) => string;

export class BlastPlanUI {
  private readonly el: HTMLElement;
  private readonly holeListEl: HTMLElement;
  private readonly chargeForm: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly tileSelect: TileSelectOverlay;
  private gameConsole?: GameConsoleFn;
  private selectedHoleId: string | null = null;
  private worldSizeX = 40;
  private worldSizeZ = 40;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-blast-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.blast.title');

    const gridBtn = this.makeBtn('bs-btn', t('ui.blast.grid_tool'), () => this.openGridTool());
    const clearBtn = this.makeBtn('bs-btn bs-btn-danger', t('ui.blast.clear_holes'), () => { this.gameConsole?.('drill_plan clear'); });
    this.holeListEl = document.createElement('div');
    this.chargeForm = document.createElement('div');
    this.chargeForm.style.display = 'none';
    this.chargeForm.style.marginTop = '8px';
    this.buildChargeForm();

    const chargeAllBtn = this.makeBtn('bs-btn bs-btn-primary', t('ui.blast.charge_all'), () => this.chargeAllHoles());
    const seqBtn = this.makeBtn('bs-btn', t('ui.blast.auto_seq'), () => {
      const output = this.gameConsole?.('sequence auto') ?? '';
      if (output.includes('Auto')) this.showStatus(t('ui.blast.status_sequenced'), 'success');
      else this.showStatus(output || t('ui.blast.status_no_holes'), 'error');
    });
    const previewBtn = this.makeBtn('bs-btn', t('ui.blast.preview'), () => { this.gameConsole?.('preview energy'); });
    const execBtn = this.makeBtn('bs-btn bs-btn-primary bs-blast-btn', t('ui.blast.execute'), () => this.confirmBlast());

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'bs-blast-status';
    this.statusEl.style.cssText = 'font-size:11px;margin:6px 0;padding:4px 6px;border-radius:4px;display:none;text-align:center';

    this.el.append(title, gridBtn, clearBtn, this.holeListEl, this.chargeForm,
      chargeAllBtn, seqBtn, previewBtn, execBtn, this.statusEl);
    container.appendChild(this.el);

    this.tileSelect = new TileSelectOverlay(document.body);
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
    const holes = state.drillHoles;
    const charges = state.chargesByHole;
    const delays = state.sequenceDelays;

    this.holeListEl.innerHTML = '';
    if (holes.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#806050;font-size:11px;margin:6px 0';
      msg.textContent = t('ui.blast.no_holes');
      this.holeListEl.appendChild(msg);
      return;
    }

    for (const hole of holes) {
      this.holeListEl.appendChild(this.makeHoleRow(hole, charges[hole.id], delays[hole.id]));
    }
  }

  dispose(): void { this.el.remove(); this.tileSelect.dispose(); }

  private showStatus(message: string, type: 'success' | 'error'): void {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusEl.textContent = message;
    this.statusEl.style.display = '';
    this.statusEl.style.background = type === 'success'
      ? 'rgba(40, 180, 80, 0.3)' : 'rgba(200, 80, 40, 0.3)';
    this.statusEl.style.color = type === 'success' ? '#80ff80' : '#ff8060';
    this.statusTimer = setTimeout(() => {
      this.statusEl.style.display = 'none';
    }, 3000);
  }

  private chargeAllHoles(): void {
    // Use the current charge form values to charge all holes at once
    const explosiveEl = this.chargeForm.querySelector('#bs-blast-explosive') as HTMLSelectElement | null;
    const amountEl = this.chargeForm.querySelector('#bs-blast-amount') as HTMLInputElement | null;
    const stemmingEl = this.chargeForm.querySelector('#bs-blast-stemming') as HTMLInputElement | null;
    const exp = explosiveEl?.value ?? 'boomite';
    const amt = amountEl?.value ?? '5';
    const stem = stemmingEl?.value ?? '2';
    const output = this.gameConsole?.(`charge hole:* explosive:${exp} amount:${amt} stemming:${stem}`) ?? '';
    if (output.includes('Charged')) {
      this.showStatus(t('ui.blast.status_charged'), 'success');
    } else if (output) {
      this.showStatus(output, 'error');
    } else {
      this.showStatus(t('ui.blast.status_no_holes'), 'error');
    }
  }

  private makeHoleRow(hole: DrillHole, charge?: HoleCharge, delayMs?: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-hole-row';

    const idEl = document.createElement('span');
    idEl.className = 'bs-hole-id';
    idEl.textContent = hole.id;

    const info = document.createElement('span');
    info.className = 'bs-charge-info';
    if (charge) {
      info.textContent = `${charge.explosiveId} ${charge.amountKg}kg +${delayMs ?? 0}ms`;
      info.style.color = '#80d080';
    } else {
      info.textContent = t('ui.blast.no_charges');
      info.style.color = '#c07050';
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'bs-btn';
    editBtn.style.cssText = 'padding:2px 8px;font-size:11px;min-width:28px';
    editBtn.textContent = t('ui.blast.edit_hole');
    editBtn.addEventListener('click', () => this.selectHole(hole.id));

    row.append(idEl, info, editBtn);
    return row;
  }

  private selectHole(holeId: string): void {
    this.selectedHoleId = holeId;
    this.chargeForm.style.display = '';
    (this.chargeForm.querySelector('.bs-hole-id-label') as HTMLElement).textContent = holeId;
  }

  private buildChargeForm(): void {
    const label = document.createElement('div');
    label.className = 'bs-hole-id-label bs-panel-title';
    label.style.fontSize = '11px';
    label.textContent = '';

    const explosiveSelect = document.createElement('select');
    explosiveSelect.className = 'bs-select';
    explosiveSelect.id = 'bs-blast-explosive';
    const explosives = ['pop_rock', 'boomite', 'krackle', 'big_bada_boom', 'shatternite', 'rumblox', 'obliviax', 'dynatomics'];
    for (const id of explosives) {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      explosiveSelect.appendChild(opt);
    }

    const amountInput = this.makeNumberInput('bs-blast-amount', '3', '1', '100', '1');
    const stemmingInput = this.makeNumberInput('bs-blast-stemming', '2', '0', '20', '0.5');

    const errorEl = document.createElement('div');
    errorEl.style.cssText = 'font-size:11px;color:#f08060;margin-top:6px;display:none;white-space:pre-wrap';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'bs-btn bs-btn-primary';
    applyBtn.style.cssText = 'width:100%;margin-top:6px';
    applyBtn.textContent = t('ui.blast.apply_charge');
    applyBtn.addEventListener('click', () => {
      if (!this.selectedHoleId) return;
      const exp = explosiveSelect.value;
      const amt = amountInput.value;
      const stem = stemmingInput.value;
      const output = this.gameConsole?.(`charge hole:${this.selectedHoleId} explosive:${exp} amount:${amt} stemming:${stem}`) ?? '';
      if (output.startsWith('Charged')) {
        this.chargeForm.style.display = 'none';
        errorEl.style.display = 'none';
        this.showStatus(output, 'success');
      } else {
        errorEl.textContent = output || 'Failed to apply charge.';
        errorEl.style.display = '';
      }
    });

    this.chargeForm.append(
      label,
      this.makeLabel(t('ui.blast.explosive')), explosiveSelect,
      this.makeLabel(t('ui.blast.amount')), amountInput,
      this.makeLabel(t('ui.blast.stemming')), stemmingInput,
      applyBtn,
      errorEl,
    );
  }

  private makeBtn(cls: string, text: string, handler: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = cls;
    btn.style.cssText = 'width:100%;margin-bottom:4px';
    btn.textContent = text;
    btn.addEventListener('click', handler);
    return btn;
  }

  private makeLabel(text: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:10px;color:#908070;margin-top:4px;margin-bottom:2px';
    el.textContent = text;
    return el;
  }

  private makeNumberInput(id: string, val: string, min: string, max: string, step: string): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'number'; el.id = id;
    el.className = 'bs-input';
    el.value = val; el.min = min; el.max = max; el.step = step;
    return el;
  }

  private openGridTool(): void {
    this.tileSelect.open({
      mode: 'area',
      worldSizeX: this.worldSizeX,
      worldSizeZ: this.worldSizeZ,
      title: t('ui.blast.grid_tool'),
      extraFields: [
        { id: 'spacing', label: t('ui.blast.grid_spacing'), defaultValue: 5, min: 1, max: 20, step: 1 },
        { id: 'depth',   label: t('ui.blast.grid_depth'),   defaultValue: 6, min: 1, max: 40, step: 1 },
      ],
      onConfirm: (result) => {
        const x1 = result.x;
        const z1 = result.z;
        const x2 = result.x2 ?? x1;
        const z2 = result.z2 ?? z1;
        const spacing = result.fields['spacing'] ?? 5;
        const depth   = result.fields['depth']   ?? 6;
        const cols = Math.max(1, Math.round((x2 - x1) / spacing) + 1);
        const rows = Math.max(1, Math.round((z2 - z1) / spacing) + 1);
        this.gameConsole?.(`drill_plan grid rows:${rows} cols:${cols} spacing:${spacing} depth:${depth} start:${x1},${z1}`);
      },
    });
  }

  private confirmBlast(): void {
    const overlay = document.createElement('div');
    overlay.className = 'bs-confirm-overlay';
    const box = document.createElement('div');
    box.className = 'bs-confirm-box';
    const msg = document.createElement('p');
    msg.textContent = t('ui.blast.confirm');
    const yesBtn = document.createElement('button');
    yesBtn.className = 'bs-btn bs-btn-danger';
    yesBtn.textContent = t('ui.blast.yes');
    yesBtn.addEventListener('click', () => { overlay.remove(); this.gameConsole?.('blast'); });
    const noBtn = document.createElement('button');
    noBtn.className = 'bs-btn';
    noBtn.textContent = t('ui.blast.no');
    noBtn.addEventListener('click', () => overlay.remove());
    box.append(msg, yesBtn, noBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
}

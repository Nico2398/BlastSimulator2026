// BlastSimulator2026 — Blast Plan Editor UI (10.2)
// Panel for placing drill holes, setting charges, sequencing, and executing blasts.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { DrillHole } from '../core/mining/DrillPlan.js';
import type { HoleCharge } from '../core/mining/ChargePlan.js';

export type GameConsoleFn = (cmd: string) => string;

interface GridToolOptions { rows: number; cols: number; spacing: number; depth: number; x: number; z: number; }

export class BlastPlanUI {
  private readonly el: HTMLElement;
  private readonly holeListEl: HTMLElement;
  private readonly chargeForm: HTMLElement;
  private gameConsole?: GameConsoleFn;

  // Grid tool form state
  private selectedHoleId: string | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-blast-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.blast.title');

    // Grid tool
    const gridBtn = document.createElement('button');
    gridBtn.className = 'bs-btn';
    gridBtn.style.marginBottom = '6px';
    gridBtn.style.width = '100%';
    gridBtn.textContent = t('ui.blast.grid_tool');
    gridBtn.addEventListener('click', () => this.openGridTool());

    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'bs-btn bs-btn-danger';
    clearBtn.style.marginBottom = '6px';
    clearBtn.style.width = '100%';
    clearBtn.textContent = t('ui.blast.clear_holes');
    clearBtn.addEventListener('click', () => { this.gameConsole?.('drill_plan clear'); });

    // Hole list
    this.holeListEl = document.createElement('div');

    // Charge form (shown when hole selected)
    this.chargeForm = document.createElement('div');
    this.chargeForm.style.display = 'none';
    this.chargeForm.style.marginTop = '8px';
    this.buildChargeForm();

    // Sequence + execute buttons
    const seqBtn = document.createElement('button');
    seqBtn.className = 'bs-btn';
    seqBtn.style.width = '100%';
    seqBtn.style.marginBottom = '4px';
    seqBtn.textContent = 'Auto Sequence';
    seqBtn.addEventListener('click', () => { this.gameConsole?.('sequence auto'); });

    const previewBtn = document.createElement('button');
    previewBtn.className = 'bs-btn';
    previewBtn.style.width = '100%';
    previewBtn.style.marginBottom = '4px';
    previewBtn.textContent = t('ui.blast.preview');
    previewBtn.addEventListener('click', () => { this.gameConsole?.('preview energy'); });

    const execBtn = document.createElement('button');
    execBtn.className = 'bs-btn bs-btn-primary bs-blast-btn';
    execBtn.textContent = t('ui.blast.execute');
    execBtn.addEventListener('click', () => this.confirmBlast());

    this.el.append(title, gridBtn, clearBtn, this.holeListEl, this.chargeForm, seqBtn, previewBtn, execBtn);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
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

  dispose(): void { this.el.remove(); }

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
    } else {
      info.textContent = t('ui.blast.no_charges');
      info.style.color = '#c07050';
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'bs-btn';
    editBtn.style.cssText = 'padding:1px 6px;font-size:10px';
    editBtn.textContent = '✏';
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

    const amountInput = this.makeNumberInput('bs-blast-amount', '5', '1', '100', '1');
    const stemmingInput = this.makeNumberInput('bs-blast-stemming', '2', '0', '20', '0.5');

    const applyBtn = document.createElement('button');
    applyBtn.className = 'bs-btn bs-btn-primary';
    applyBtn.style.cssText = 'width:100%;margin-top:6px';
    applyBtn.textContent = 'Apply Charge';
    applyBtn.addEventListener('click', () => {
      if (!this.selectedHoleId) return;
      const exp = explosiveSelect.value;
      const amt = amountInput.value;
      const stem = stemmingInput.value;
      this.gameConsole?.(`charge hole:${this.selectedHoleId} explosive:${exp} amount:${amt} stemming:${stem}`);
      this.chargeForm.style.display = 'none';
    });

    this.chargeForm.append(
      label,
      this.makeLabel(t('ui.blast.explosive')), explosiveSelect,
      this.makeLabel(t('ui.blast.amount')), amountInput,
      this.makeLabel(t('ui.blast.stemming')), stemmingInput,
      applyBtn,
    );
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
    const opts = prompt('Grid: rows,cols,spacing,depth,startX,startZ (e.g. 3,3,5,6,20,20)');
    if (!opts) return;
    const [rows, cols, spacing, depth, x, z] = opts.split(',').map(Number) as [number,number,number,number,number,number];
    if ([rows, cols, spacing, depth, x, z].some(isNaN)) return;
    const o: GridToolOptions = { rows, cols, spacing, depth, x, z };
    this.gameConsole?.(`drill_plan grid rows:${o.rows} cols:${o.cols} spacing:${o.spacing} depth:${o.depth} start:${o.x},${o.z}`);
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

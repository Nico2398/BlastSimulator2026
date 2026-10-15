// BlastSimulator2026 — Sandbox setup screen
//
// Builds its form from SANDBOX_FIELDS rather than hard-coding controls, so a
// parameter added to the sandbox config surfaces here and in the console
// command at the same time and the two can't drift.
//
// Every control carries a stable id (`bs-sandbox-<key>`) because the
// playability channel drives this screen by clicking, and a form addressed by
// position breaks the moment a field is inserted.

import { t } from '../core/i18n/I18n.js';
import { ORE_DEPTH_UNBOUNDED } from '../core/world/OreCatalog.js';
import { formatMoney } from '../core/economy/formatMoney.js';
import { buildingDisplayName, vehicleDisplayName } from './fleetDetailSections.js';
import {
  SANDBOX_DEFAULTS,
  SANDBOX_FIELDS,
  clampSandboxConfig,
  randomSandboxSeed,
  sandboxBiomeTraits,
  sandboxDifficultyDetails,
  type SandboxConfig,
  type SandboxDifficultyId,
  type SandboxField,
} from '../core/campaign/Sandbox.js';

export type OnSandboxStart = (config: SandboxConfig) => void;
export type OnSandboxBack = () => void;

const ROW_STYLE = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0';
const LABEL_STYLE = 'font:600 11px/1.3 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1';
// Same field look as the Contracts amount and Operations threshold inputs.
const INPUT_STYLE = [
  'height:30px;padding:0 10px;border-radius:4px;border-style:solid;border-width:1px;border-color:var(--bsx-hairline-strong)',
  'background:var(--bsx-well);color:var(--bsx-text-primary);font:600 11px/1 var(--bsx-font-mono)',
  // Native select popups and number spinners follow the dark scheme.
  'color-scheme:dark',
].join(';');
const NUMBER_INPUT_STYLE = `width:120px;${INPUT_STYLE}`;
// Choice labels ("Desert Badlands", French names) must fit unclipped at 1280x720.
const SELECT_STYLE = `min-width:180px;width:auto;max-width:240px;${INPUT_STYLE}`;
const DETAIL_BLOCK_STYLE = 'display:flex;flex-direction:column;gap:3px;margin-top:6px;font:400 11px/1.5 var(--bsx-font-ui);color:var(--bsx-text-muted);overflow-wrap:anywhere';

export class SandboxPanel {
  private readonly overlay: HTMLElement;
  private readonly body: HTMLElement;
  private config: SandboxConfig = { ...SANDBOX_DEFAULTS };
  private onStart?: OnSandboxStart;
  private onBack?: OnSandboxBack;
  /** Live controls by config key, so randomising the seed can write back into its input. */
  private readonly inputs = new Map<string, HTMLInputElement>();
  /** Biome and difficulty detail blocks, refreshed in place when a selection changes (#1686). */
  private biomeBlock!: HTMLElement;
  private difficultyBlock!: HTMLElement;
  /** Header title, retranslated on every open so a locale switch in the menu shows. */
  private titleEl!: HTMLElement;
  /** Injectable RNG for the seed, so tests stay deterministic (#504). */
  private readonly rand: () => number;

  constructor(container: HTMLElement, rand: () => number = Math.random) {
    this.rand = rand;
    this.overlay = document.createElement('div');
    this.overlay.id = 'bs-sandbox-panel';
    this.overlay.className = 'bsx-root';
    this.overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10000;display:none',
      'flex-direction:column;align-items:center;justify-content:center;gap:12px',
      'background:var(--bsx-app)',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'display:flex;flex-direction:column;gap:6px;min-width:420px;max-width:560px',
      'background:var(--bsx-panel);border:1px solid var(--bsx-hairline-strong)',
      'border-radius:9px;padding:0 0 18px',
      'box-shadow:0 30px 80px rgba(0,0,0,.7)',
      'max-height:86vh;overflow-y:auto',
    ].join(';');

    this.body = document.createElement('div');
    this.body.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:0 24px';

    box.append(this.header(), this.body);
    this.overlay.append(box);
    container.appendChild(this.overlay);
  }

  setOnStart(fn: OnSandboxStart): void { this.onStart = fn; }
  setOnBack(fn: OnSandboxBack): void { this.onBack = fn; }

  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  /** Current configuration, clamped — exposed for tests and the state bridge. */
  getConfig(): SandboxConfig { return clampSandboxConfig(this.config); }

  show(): void {
    // A fresh random seed every time the panel opens, without touching the
    // previously selected biome/difficulty (#504).
    this.config = clampSandboxConfig({ ...this.config, seed: randomSandboxSeed(this.rand) });
    this.render();
    this.overlay.style.display = 'flex';
  }

  hide(): void { this.overlay.style.display = 'none'; }

  dispose(): void { this.overlay.remove(); }

  // ---- Internal ----

  /** Header bar matching the Settings and Saved games modals. */
  private header(): HTMLElement {
    const bar = document.createElement('div');
    bar.style.cssText = [
      'flex:0 0 auto;display:flex;align-items:center;height:46px;padding:0 24px',
      'background:#1a2028;border-bottom:1px solid var(--bsx-hairline)',
    ].join(';');
    const title = document.createElement('div');
    title.style.cssText = 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--bsx-text-primary)';
    this.titleEl = title;
    bar.append(title);
    return bar;
  }

  private render(): void {
    this.titleEl.textContent = t('sandbox.title');
    this.body.innerHTML = '';
    this.inputs.clear();

    const blurb = document.createElement('div');
    blurb.style.cssText = 'font:400 11px/1.5 var(--bsx-font-ui);color:var(--bsx-text-micro);margin:12px 0 8px';
    blurb.textContent = t('sandbox.blurb');

    this.body.append(blurb);

    for (const field of SANDBOX_FIELDS) this.body.appendChild(this.renderField(field));

    this.biomeBlock = document.createElement('div');
    this.biomeBlock.style.cssText = DETAIL_BLOCK_STYLE;
    this.difficultyBlock = document.createElement('div');
    this.difficultyBlock.style.cssText = DETAIL_BLOCK_STYLE;
    this.body.append(this.biomeBlock, this.difficultyBlock);
    this.renderDetails();

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:14px';

    const backBtn = document.createElement('button');
    backBtn.id = 'bs-sandbox-back';
    backBtn.className = 'bsx-btn';
    backBtn.style.cssText = 'flex:1';
    backBtn.textContent = '← ' + t('ui.back');
    backBtn.addEventListener('click', () => { this.hide(); this.onBack?.(); });

    const startBtn = document.createElement('button');
    startBtn.id = 'bs-sandbox-start';
    startBtn.className = 'bsx-btn bsx-btn-primary';
    startBtn.style.cssText = 'flex:2';
    startBtn.textContent = t('sandbox.start');
    startBtn.addEventListener('click', () => {
      this.hide();
      this.onStart?.(this.getConfig());
    });

    actions.append(backBtn, startBtn);
    this.body.appendChild(actions);
  }

  private renderField(field: SandboxField): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = ROW_STYLE;

    const label = document.createElement('label');
    label.style.cssText = LABEL_STYLE;
    label.htmlFor = `bs-sandbox-${String(field.key)}`;
    label.textContent = t(field.labelKey);
    row.appendChild(label);

    const control = field.kind === 'choice' ? this.renderChoice(field) : this.renderNumber(field);

    // The seed is the one field a player copies down and types back in, so it
    // gets a randomise control right next to it.
    if (field.key === 'seed') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:6px;align-items:center';
      const dice = document.createElement('button');
      dice.id = 'bs-sandbox-randomize';
      dice.className = 'bsx-btn';
      dice.style.cssText = 'width:34px;padding:0;font-size:13px';
      dice.title = t('sandbox.randomize');
      dice.setAttribute('aria-label', t('sandbox.randomize'));
      dice.textContent = '🎲';
      dice.addEventListener('click', () => {
        this.config.seed = randomSandboxSeed(this.rand);
        const input = this.inputs.get('seed');
        if (input) input.value = String(this.config.seed);
      });
      wrap.append(control, dice);
      row.appendChild(wrap);
      return row;
    }

    row.appendChild(control);
    return row;
  }

  private renderNumber(field: SandboxField): HTMLElement {
    const input = document.createElement('input');
    input.id = `bs-sandbox-${String(field.key)}`;
    input.type = 'number';
    input.style.cssText = NUMBER_INPUT_STYLE;
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (field.step !== undefined) input.step = String(field.step);
    input.value = String(this.config[field.key]);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      if (!Number.isFinite(next)) return;
      // Clamp through the shared validator so the panel can never hand the
      // generator a size or depth the engine was not built for.
      this.config = clampSandboxConfig({ ...this.config, [field.key]: next });
    });
    this.inputs.set(String(field.key), input);
    return input;
  }

  private renderChoice(field: SandboxField): HTMLElement {
    const select = document.createElement('select');
    select.id = `bs-sandbox-${String(field.key)}`;
    select.style.cssText = SELECT_STYLE;
    for (const option of field.options?.() ?? []) {
      const el = document.createElement('option');
      el.value = option.id;
      el.textContent = t(option.labelKey);
      select.appendChild(el);
    }
    select.value = String(this.config[field.key]);
    select.addEventListener('change', () => {
      this.config = clampSandboxConfig({ ...this.config, [field.key]: select.value });
      this.renderDetails();
    });
    return select;
  }

  private renderDetails(): void {
    const config = this.getConfig();
    this.renderBiomeDetails(config.biome);
    this.renderDifficultyDetails(config.difficulty);
  }

  private renderBiomeDetails(biomeId: string): void {
    const biome = sandboxBiomeTraits(biomeId);
    const lines: [string, string][] = [
      ['desc', t(biome.descKey)],
      ['hardness', biome.hardnessTierMin === biome.hardnessTierMax
        ? t('sandbox.detail.hardness_single', { tier: biome.hardnessTierMin })
        : t('sandbox.detail.hardness', { min: biome.hardnessTierMin, max: biome.hardnessTierMax })],
    ];
    if (biome.ores.length > 0) {
      lines.push(['ores', t('sandbox.detail.ores', {
        list: biome.ores.map(o => t(o.nameKey)).join(', '),
        depth: oreDepthWindow(biome.oreDepthMin, biome.oreDepthMax),
      })]);
    }
    lines.push(['terrain', t('sandbox.detail.terrain', { terrain: t(`sandbox.terrain.${biome.ruggedness}`) })]);
    this.biomeBlock.replaceChildren(...lines.map(([key, text]) => detailLine(`bs-sandbox-biome-${key}`, text)));
  }

  private renderDifficultyDetails(difficulty: SandboxDifficultyId): void {
    const diff = sandboxDifficultyDetails(difficulty);
    const list = (items: string[]): string => items.length > 0 ? items.join(', ') : t('sandbox.detail.none');
    const opening = t('sandbox.detail.opens_with', {
      crew: list(diff.crew.map(c => `${c.count}× ${t(`role.${c.role}`)}`)),
      vehicles: list(diff.vehicles.map(v => `${v.count}× ${t(`vehicle_type.${v.role}`)} (${vehicleDisplayName(v.role, v.tier)})`)),
      buildings: list(diff.buildings.map(b => `${b.count}× ${buildingDisplayName(b.type, b.tier)}`)),
    });
    this.difficultyBlock.replaceChildren(
      detailLine('bs-sandbox-difficulty-cash', t('sandbox.detail.cash', { cash: formatMoney(diff.startingCash) })),
      detailLine('bs-sandbox-difficulty-opening', opening),
    );
  }

  // renderBoolean/renderExplosives removed (#504) — SandboxConfig no longer
  // carries a boolean or multi field (mixedRockHardness/availableExplosives
  // are gone), so SandboxFieldKind no longer has 'boolean'/'multi' variants.
}

function detailLine(id: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.textContent = text;
  return el;
}

/** Player-facing ore depth window; open-ended windows read "from N m down". */
function oreDepthWindow(min: number, max: number): string {
  return max >= ORE_DEPTH_UNBOUNDED
    ? t('sandbox.detail.depth_open', { min })
    : t('sandbox.detail.depth_range', { min, max });
}

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
import {
  SANDBOX_DEFAULTS,
  SANDBOX_FIELDS,
  clampSandboxConfig,
  randomSandboxSeed,
  type SandboxConfig,
  type SandboxField,
} from '../core/campaign/Sandbox.js';

export type OnSandboxStart = (config: SandboxConfig) => void;
export type OnSandboxBack = () => void;

const ROW_STYLE = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0';
const LABEL_STYLE = 'font-size:12px;color:#c0a060;flex:1';
const INPUT_STYLE = [
  'width:120px;padding:4px 6px;font-size:12px;font-family:monospace',
  'background:rgba(0,0,0,0.5);color:#ffe0a0',
  'border:1px solid rgba(200,160,60,0.35);border-radius:4px',
].join(';');

export class SandboxPanel {
  private readonly overlay: HTMLElement;
  private readonly body: HTMLElement;
  private config: SandboxConfig = { ...SANDBOX_DEFAULTS };
  private onStart?: OnSandboxStart;
  private onBack?: OnSandboxBack;
  /** Live controls by config key, so randomising the seed can write back into its input. */
  private readonly inputs = new Map<string, HTMLInputElement>();

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'bs-sandbox-panel';
    this.overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10000;display:none',
      'flex-direction:column;align-items:center;justify-content:center;gap:12px',
      'background:#060402',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'display:flex;flex-direction:column;gap:6px;min-width:420px;max-width:560px',
      'background:rgba(8,6,3,0.9);border:1px solid rgba(200,160,60,0.25)',
      'border-radius:12px;padding:20px 24px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.6)',
      'max-height:86vh;overflow-y:auto',
    ].join(';');

    this.body = document.createElement('div');
    this.body.style.cssText = 'display:flex;flex-direction:column;gap:2px';

    box.append(this.body);
    this.overlay.append(box);
    container.appendChild(this.overlay);
  }

  setOnStart(fn: OnSandboxStart): void { this.onStart = fn; }
  setOnBack(fn: OnSandboxBack): void { this.onBack = fn; }

  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  /** Current configuration, clamped — exposed for tests and the state bridge. */
  getConfig(): SandboxConfig { return clampSandboxConfig(this.config); }

  show(): void {
    this.render();
    this.overlay.style.display = 'flex';
  }

  hide(): void { this.overlay.style.display = 'none'; }

  dispose(): void { this.overlay.remove(); }

  // ---- Internal ----

  private render(): void {
    this.body.innerHTML = '';
    this.inputs.clear();

    const title = document.createElement('div');
    title.style.cssText = [
      'font-weight:700;font-size:13px;letter-spacing:0.06em;text-transform:uppercase',
      'color:#ffc840;margin-bottom:2px;border-bottom:1px solid rgba(200,160,60,0.25);padding-bottom:8px',
    ].join(';');
    title.textContent = t('sandbox.title');

    const blurb = document.createElement('div');
    blurb.style.cssText = 'font-size:11px;color:#6a5030;margin:4px 0 8px;line-height:1.5';
    blurb.textContent = t('sandbox.blurb');

    this.body.append(title, blurb);

    for (const field of SANDBOX_FIELDS) this.body.appendChild(this.renderField(field));

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:14px';

    const backBtn = document.createElement('button');
    backBtn.id = 'bs-sandbox-back';
    backBtn.className = 'bs-btn';
    backBtn.style.cssText = 'flex:1;padding:9px 12px;font-size:12px';
    backBtn.textContent = '← ' + t('ui.back');
    backBtn.addEventListener('click', () => { this.hide(); this.onBack?.(); });

    const startBtn = document.createElement('button');
    startBtn.id = 'bs-sandbox-start';
    startBtn.className = 'bs-btn bs-btn-primary';
    startBtn.style.cssText = 'flex:2;padding:9px 12px;font-size:12px;font-weight:700';
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

    if (field.kind === 'multi') {
      row.style.flexDirection = 'column';
      row.style.alignItems = 'stretch';
      row.appendChild(this.renderExplosives());
      return row;
    }

    const control = field.kind === 'choice' ? this.renderChoice(field)
      : field.kind === 'boolean' ? this.renderBoolean(field)
      : this.renderNumber(field);

    // The seed is the one field a player copies down and types back in, so it
    // gets a randomise control right next to it.
    if (field.key === 'seed') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:6px;align-items:center';
      const dice = document.createElement('button');
      dice.id = 'bs-sandbox-randomize';
      dice.className = 'bs-btn';
      dice.style.cssText = 'padding:4px 9px;font-size:13px;line-height:1';
      dice.title = t('sandbox.randomize');
      dice.setAttribute('aria-label', t('sandbox.randomize'));
      dice.textContent = '🎲';
      dice.addEventListener('click', () => {
        this.config.seed = randomSandboxSeed();
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
    input.style.cssText = INPUT_STYLE;
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
    select.style.cssText = INPUT_STYLE;
    for (const option of field.options?.() ?? []) {
      const el = document.createElement('option');
      el.value = option.id;
      el.textContent = t(option.labelKey);
      select.appendChild(el);
    }
    select.value = String(this.config[field.key]);
    select.addEventListener('change', () => {
      this.config = clampSandboxConfig({ ...this.config, [field.key]: select.value });
    });
    return select;
  }

  private renderBoolean(field: SandboxField): HTMLElement {
    const input = document.createElement('input');
    input.id = `bs-sandbox-${String(field.key)}`;
    input.type = 'checkbox';
    input.style.cssText = 'width:16px;height:16px;accent-color:#c08030';
    input.checked = Boolean(this.config[field.key]);
    input.addEventListener('change', () => {
      this.config = clampSandboxConfig({ ...this.config, [field.key]: input.checked });
    });
    return input;
  }

  /**
   * Explosive availability. Nothing ticked means "all of them" — the same
   * convention the config uses, so a player who ignores this row gets the full
   * catalog rather than an unplayable site with no explosives.
   */
  private renderExplosives(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.id = 'bs-sandbox-availableExplosives';
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:4px';

    const field = SANDBOX_FIELDS.find(f => f.key === 'availableExplosives')!;
    for (const option of field.options?.() ?? []) {
      const tag = document.createElement('label');
      tag.style.cssText = [
        'display:flex;align-items:center;gap:4px;font-size:11px;color:#a08850',
        'border:1px solid rgba(200,160,60,0.25);border-radius:4px;padding:3px 7px;cursor:pointer',
      ].join(';');

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = `bs-sandbox-explosive-${option.id}`;
      box.style.cssText = 'width:12px;height:12px;accent-color:#c08030';
      box.checked = this.config.availableExplosives.includes(option.id);
      box.addEventListener('change', () => {
        const current = new Set(this.config.availableExplosives);
        if (box.checked) current.add(option.id); else current.delete(option.id);
        this.config = clampSandboxConfig({ ...this.config, availableExplosives: [...current] });
      });

      const text = document.createElement('span');
      text.textContent = t(option.labelKey);
      tag.append(box, text);
      wrap.appendChild(tag);
    }

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:#5a4428;width:100%;margin-top:2px';
    hint.textContent = t('sandbox.explosives_hint');
    wrap.appendChild(hint);
    return wrap;
  }
}

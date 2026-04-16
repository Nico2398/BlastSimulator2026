// BlastSimulator2026 — Survey UI (10.8)
// Shows survey results for rock layers and ore densities at a grid position.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class SurveyUI {
  private readonly el: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private surveyMode = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-survey-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.survey.title');

    const surveyBtn = document.createElement('button');
    surveyBtn.className = 'bs-btn bs-btn-primary';
    surveyBtn.style.cssText = 'width:100%;margin-bottom:6px';
    surveyBtn.textContent = t('ui.survey.mode');
    surveyBtn.addEventListener('click', () => {
      this.surveyMode = !this.surveyMode;
      surveyBtn.textContent = this.surveyMode ? t('ui.survey.exit') : t('ui.survey.mode');
      if (this.surveyMode) {
        this.gameConsole?.('survey mode');
      }
    });

    this.resultsEl = document.createElement('div');
    this.resultsEl.style.cssText = 'font-size:11px;color:#c0a070';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    closeBtn.textContent = t('ui.survey.close');
    closeBtn.addEventListener('click', () => {
      this.surveyMode = false;
      surveyBtn.textContent = t('ui.survey.mode');
      this.hide();
    });

    this.el.append(title, surveyBtn, this.resultsEl, closeBtn);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  showSurveyResult(x: number, z: number, result: string): void {
    this.resultsEl.innerHTML = '';

    const posLine = document.createElement('div');
    posLine.style.cssText = 'color:#a08060;margin-bottom:4px';
    posLine.textContent = t('ui.survey.pos', { x: String(x), z: String(z) });

    const content = document.createElement('pre');
    content.style.cssText = 'margin:0;font-family:inherit;font-size:10px;white-space:pre-wrap;color:#c0a070';
    content.textContent = result;

    this.resultsEl.append(posLine, content);
  }

  update(_state: GameState): void {
    // Survey data is injected via showSurveyResult when user clicks terrain
  }

  dispose(): void { this.el.remove(); }
}

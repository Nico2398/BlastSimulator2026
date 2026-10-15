/** Inspector content for employee selections (#1756, #1762). */
import { t } from '../../../core/i18n/I18n.js';
import { computeEmployeeActivity } from '../../../core/entities/EmployeeActivity.js';
import { managementLevelOf, type Employee } from '../../../core/entities/Employee.js';
import type { GameState } from '../../../core/state/GameState.js';
import { el } from '../../dom.js';
import {
  describeActivity, makeCurrentTaskSection, makeDismissSection, makeHiredLocationStrip, makeIdentitySection,
  makeManagerEffect, makeNeedsSection, makePaySection, makeRestSection, makeSkillsSection, makeTrainingSection,
} from '../../crewDetailSections.js';
import type { InspectorLinks, KindContent } from './InspectorContent.js';
import { kindLabel, linkFactory, syncSection } from './inspectorWidgets.js';

/** Every section in display order; `build` may return null for an optional section that does not apply. */
function sectionBuilders(e: Employee, state: GameState, links: InspectorLinks): Array<[string, () => HTMLElement | null]> {
  const link = linkFactory(links);
  return [
    ['bs-emp-identity', () => makeIdentitySection(e, state)],
    ['bs-emp-location', () => makeHiredLocationStrip(e, state, link)],
    ['bs-emp-task', () => makeCurrentTaskSection(e, state, link)],
    ['bs-emp-rest', () => makeRestSection(e, state, link)],
    ['bs-emp-needs', () => makeNeedsSection(e)],
    ['bs-emp-skills', () => makeSkillsSection(e)],
    ['bs-emp-pay', () => makePaySection(e, amount => links.run(`employee raise ${e.id} amount:${amount}`))],
    ['bs-emp-training', () => makeTrainingSection(e, state, (skill, buildingId) => links.run(`employee train ${e.id} skill:${skill} building:${buildingId}`), link)],
    ['bs-emp-manager', () => makeManagerEffect(e)],
    ['bs-emp-dismiss', () => makeDismissSection(e, () => requestDismiss(e, links))],
  ];
}

/** Dismissal is permanent, so it always goes through the shared confirm overlay (same config as the Crew row). */
function requestDismiss(e: Employee, links: InspectorLinks): void {
  links.confirm({
    icon: 'injured',
    title: t('ui.crew.dismiss_confirm_title'),
    body: t('ui.crew.dismiss_confirm_body', { name: e.name }),
    confirmLabel: t('ui.crew.dismiss'),
    onConfirm: () => links.run(`employee fire ${e.id}`),
  });
}

export const employeeContent: KindContent = {
  view(entity, state, links) {
    const e = state.employees.employees.find(x => x.id === entity.id);
    if (!e) return null;
    const role = t(`role.${e.role}`);
    const build = (): HTMLElement => {
      const body = el('div', { className: 'bs-employee-detail' });
      body.style.cssText = 'display:flex;flex-direction:column;gap:11px';
      for (const [className, make] of sectionBuilders(e, state, links)) {
        const node = make();
        if (node) { node.classList.add(className); body.append(node); }
      }
      return body;
    };
    const optional = `${e.restTicksRemaining !== null || e.pendingRestDuration !== null ? 'r' : ''}${managementLevelOf(e) !== null ? 'm' : ''}`;
    return {
      title: e.name,
      sub: `#${e.id} · ${kindLabel('employee')} · ${role}`,
      icon: 'person',
      status: describeActivity(computeEmployeeActivity(e, state.vehicles)),
      signature: `${e.id}:${optional}`,
      get sections() { return [build()]; },
      actions: [
        { action: 'detail', labelKey: 'inspector.action.detail', icon: 'person', variant: 'ghost' },
        { action: 'dispatch_here', labelKey: 'inspector.action.dispatch_here', icon: 'locate', variant: 'ghost' },
        { action: 'train', labelKey: 'inspector.action.train', icon: 'training', variant: 'ghost' },
      ],
      sync: root => {
        const body = root.querySelector<HTMLElement>('.bs-employee-detail');
        if (!body) return;
        for (const [className, make] of sectionBuilders(e, state, links)) syncSection(body, className, make);
      },
    };
  },
};

/** Inspector content for employee selections (#1756). */
import { t } from '../../../core/i18n/I18n.js';
import type { KindContent } from './InspectorContent.js';
import { kindLabel, liveRow, sectionOf } from './inspectorWidgets.js';

export const employeeContent: KindContent = {
  view(entity, state) {
    const e = state.employees.employees.find(x => x.id === entity.id);
    if (!e) return null;
    const role = t(`role.${e.role}`);
    return {
      title: e.name,
      sub: `#${e.id} · ${kindLabel('employee')} · ${role}`,
      icon: 'person',
      status: role,
      signature: `${e.name}:${e.role}`,
      get sections() { return [sectionOf(t('inspector.section.details'), [liveRow(t('inspector.role'), 'role', role)])]; },
      actions: [
        { action: 'detail', labelKey: 'inspector.action.detail', icon: 'person', variant: 'ghost' },
        { action: 'dispatch_here', labelKey: 'inspector.action.dispatch_here', icon: 'locate', variant: 'ghost' },
        { action: 'train', labelKey: 'inspector.action.train', icon: 'training', variant: 'ghost' },
      ],
      sync: () => {},
    };
  },
};

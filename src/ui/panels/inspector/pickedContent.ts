/** Inspector content for fragment, drill-hole and ramp selections (#1756). */
import { t } from '../../../core/i18n/I18n.js';
import { holeNumericId } from '../../../core/mining/DrillPlan.js';
import { nextRampWidth } from '../../../core/mining/RampWidening.js';
import { describeRamp } from '../../describeRamp.js';
import type { InspectorView, KindContent } from './InspectorContent.js';
import { kindLabel, liveRow, sectionOf, setLive } from './inspectorWidgets.js';

export const pickedContent: KindContent = {
  view(entity, state): InspectorView | null {
    switch (entity.kind) {
      case 'hole': {
        const hole = state.drillHoles.find(h => holeNumericId(h.id) === entity.id);
        if (!hole) return null;
        const depth = `${hole.depth}m`;
        return {
          title: hole.id,
          sub: `#${entity.id} · ${kindLabel('hole')}`,
          icon: 'hole',
          status: t('inspector.status_hole'),
          signature: hole.id,
          get sections() { return [sectionOf(t('inspector.section.details'), [liveRow(t('inspector.depth'), 'depth', depth)])]; },
          actions: [],
          sync: root => { setLive(root, 'depth', depth); },
        };
      }
      case 'ramp': {
        const ramp = state.builtRamps.find(r => r.id === entity.id);
        if (!ramp) return null;
        const desc = describeRamp(ramp);
        const canWiden = nextRampWidth(ramp.width) !== null;
        return {
          title: desc.title,
          sub: `#${ramp.id} · ${kindLabel('ramp')}`,
          icon: 'layers',
          status: desc.sub,
          signature: `${ramp.id}:${ramp.width}`,
          get sections() { return [sectionOf(t('inspector.section.details'), [liveRow(t('inspector.description'), 'description', desc.sub)])]; },
          actions: canWiden ? [{ action: 'widen', labelKey: 'inspector.action.widen', icon: 'up', variant: 'ghost' }] : [],
          sync: root => { setLive(root, 'description', desc.sub); },
        };
      }
      case 'fragment':
        return {
          title: t('shell.hovertag.fragment', { id: entity.id }),
          sub: `#${entity.id} · ${kindLabel('fragment')}`,
          icon: 'rock',
          status: t('inspector.status_fragment'),
          signature: 'fragment',
          sections: [],
          actions: [],
          sync: () => {},
        };
      default:
        return null;
    }
  },
};

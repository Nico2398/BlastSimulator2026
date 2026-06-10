// BlastSimulator2026 — typed i18n key constants
// Import from here to get autocomplete and catch typos at compile time.

export const I18nKeys = {
  game: {
    title: 'game.title',
    subtitle: 'game.subtitle',
    version: 'game.version',
  },
  blast: {
    fragments: 'blast.fragments',
    noCasualties: 'blast.no_casualties',
    oversizedAlert: 'blast.oversized_alert',
    projections: 'blast.projections',
  },
  nav: {
    agentStuck: 'nav.agent_stuck',
    noRampAvailable: 'nav.no_ramp_available',
  },
  building: {
    full: 'building.full',
  },
  need: {
    wellRestedBonus: 'need.well_rested_bonus',
  },
  event: {
    employeeCollapsed: {
      title: 'event.employee_collapsed.title',
      hunger: {
        desc: 'event.employee_collapsed.hunger.desc',
      },
      fatigue: {
        desc: 'event.employee_collapsed.fatigue.desc',
      },
      breakNeed: {
        desc: 'event.employee_collapsed.breakNeed.desc',
      },
    },
    employeeShiftChange: {
      title: 'event.employee_shift_change.title',
      desc: 'event.employee_shift_change.desc',
    },
    needWarning: {
      title: 'event.need_warning.title',
      hunger: {
        desc: 'event.need_warning.hunger.desc',
      },
      fatigue: {
        desc: 'event.need_warning.fatigue.desc',
      },
      breakNeed: {
        desc: 'event.need_warning.breakNeed.desc',
      },
    },
  },
} as const;

export type I18nKey = string;

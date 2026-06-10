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
} as const;

export type I18nKey = string;

// BlastSimulator2026 — i18n terminology glossary (issue #492, section 1)
//
// Canonical term registry for the locale-content-correctness sweep. For
// every concept where either locale/`src/core/i18n/locales/{en,fr}.json`
// currently carries more than one wording, this records the ONE term each
// locale must converge on and the synonyms actually found in the files
// that must not survive. Populated from a full read of both locale files
// (3231 keys each) plus a grep of `src/**/*.ts` to tell live keys from
// orphaned/dead ones.
//
// Consumers:
//   - test-writer: assert, per GlossaryEntry, that `fr.canonical` (and
//     `en.canonical`) is the only wording present across `relevantKeys`,
//     and that none of `forbiddenSynonyms` appears anywhere in the locale
//     file for that language.
//   - implementer: the rename target for each locale file edit.
//
// Pure data — no side effects — so it stays importable from Node scripts
// and browser code alike, matching `localeSharedValuesAllowlist.ts`.
//
// Scope note: entries only cover keys that name a role, action, or panel
// to the player. Narrative/event flavour text may legitimately use a
// looser synonym for colour (an event calling someone "the geologist",
// weather flavour text using generic lowercase "conducteur" for "a
// driver") — that is intentionally excluded from `relevantKeys` unless the
// flavour text is itself the literal defect being tracked.

/** One locale's canonical wording for a concept, and what must not remain. */
export interface LocaleTerm {
  /** The one wording that must appear everywhere this concept is named. */
  canonical: string;
  /** Wordings found in the current files for this concept that must go. */
  forbiddenSynonyms: string[];
}

/** A single concept with more (or previously more) than one name in the files. */
export interface GlossaryEntry {
  /** Short machine name for the concept, for test descriptions. */
  concept: string;
  en: LocaleTerm;
  fr: LocaleTerm;
  /** Keys known to reference this concept — starting point for the test-writer's scan; not exhaustive over all 3231 keys. */
  relevantKeys: string[];
  /** Evidence / rationale for the canonical choice and any scope caveats. */
  note: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  // ── Roles (role.* is the source of truth: it's what t(`role.${e.role}`) renders on every employee card/tooltip) ──

  {
    concept: 'role_surveyor',
    en: { canonical: 'Surveyor', forbiddenSynonyms: [] },
    fr: { canonical: 'Prospecteur', forbiddenSynonyms: ['Géomètre', 'géomètre', 'géologue', 'Géologue'] },
    relevantKeys: [
      'role.surveyor',
      'tutorial.step2', 'tutorial.step2.title', 'tutorial.stage.hire_surveyor',
      'ui.survey.queued', 'ui.survey.no_surveyor',
    ],
    note: "fr.json currently has three names for this role: role.surveyor='Prospecteur', tutorial.step2(.title)/tutorial.stage.hire_surveyor='géomètre', ui.survey.queued/no_surveyor='géologue'. Canonical picked as role.surveyor's value since that string is what actually renders on employee cards via role.${role} lookups. event.barren_blast.* / event.mafia_geology_nerd.* using 'géologue' are narrative flavour (a different in-fiction character), not this role — out of scope.",
  },
  {
    concept: 'role_driller',
    en: { canonical: 'Driller', forbiddenSynonyms: [] },
    fr: { canonical: 'Foreur', forbiddenSynonyms: [] },
    relevantKeys: ['role.driller', 'tutorial.step4', 'tutorial.step4.title', 'tutorial.stage.hire_driller'],
    note: 'Baseline entry — already consistent in both locales. Kept for regression coverage: the issue calls for a full sweep of all 5 roles, not just the ones already found broken.',
  },
  {
    concept: 'role_blaster',
    en: { canonical: 'Blaster', forbiddenSynonyms: [] },
    fr: { canonical: 'Artificier', forbiddenSynonyms: [] },
    relevantKeys: ['role.blaster'],
    note: 'Baseline entry — already consistent in both locales (event.lawsuit_blaster_discrimination / event.lawsuit_wrongful_termination flavour text uses lowercase "artificier" narratively, which is fine).',
  },
  {
    concept: 'role_driver',
    en: { canonical: 'Driver', forbiddenSynonyms: [] },
    fr: { canonical: 'Chauffeur', forbiddenSynonyms: ['Conducteur', 'conducteur'] },
    relevantKeys: [
      'role.driver',
      'tutorial.step13', 'tutorial.step13.title', 'tutorial.step14',
      'tutorial.stage.hire_driver',
    ],
    note: "role.driver='Chauffeur', but every tutorial key that names the hireable role instead says 'conducteur' (5 occurrences). Canonical picked as role.driver's value for the same reason as role_surveyor. Generic narrative uses of 'conducteur' in weather event flavour text (e.g. event.weather_dust_storm.res1, event.weather_sun_glare.*) are not in scope — those describe an anonymous vehicle operator, not the hireable role.",
  },
  {
    concept: 'role_manager',
    en: { canonical: 'Manager', forbiddenSynonyms: [] },
    fr: { canonical: 'Gérant', forbiddenSynonyms: ['Gestionnaire', 'responsable', 'Responsable'] },
    relevantKeys: ['role.manager', 'tutorial.step11', 'tutorial.step11.title', 'tutorial.stage.hire_manager'],
    note: "role.manager='Gérant', but tutorial.step11.title says 'Gestionnaire' and tutorial.stage.hire_manager says 'responsable' — three fr words for one role. Canonical picked as role.manager's value, same rationale as role_surveyor/role_driver.",
  },

  // ── Survey action ──

  {
    concept: 'survey_action',
    en: { canonical: 'Survey', forbiddenSynonyms: [] },
    fr: { canonical: 'Sondage', forbiddenSynonyms: ['étude sismique'] },
    relevantKeys: [
      'ui.survey.title', 'shell.rail.survey', 'shortcuts.survey', 'survey.seismic',
      'tutorial.step3', 'tutorial.stage.survey_method',
    ],
    note: "en.json already converges on 'Survey' everywhere (ui.survey.title, ui.toolbar.survey [dead, see ORPHAN_KEYS], shell.rail.survey, shortcuts.survey). fr.json converges on 'Sondage' (ui.survey.title, ui.toolbar.survey [dead], shell.rail.survey, ui.crew.action_survey, shortcuts.survey, survey.seismic='Sondage sismique') EXCEPT tutorial.step3, which says 'une étude sismique' instead of matching survey.seismic's 'Sondage sismique'.",
  },

  // ── Panels (canonical = the string that actually renders as the panel's on-screen title, per src/ui/panels/*.ts) ──

  {
    concept: 'panel_crew',
    en: { canonical: 'Crew', forbiddenSynonyms: ['Employee panel', 'Employees panel'] },
    fr: { canonical: 'Équipe', forbiddenSynonyms: ['panneau des employés'] },
    relevantKeys: [
      'ui.crew.title', 'shell.rail.employees',
      'tutorial.step2', 'tutorial.step4', 'tutorial.step13', 'tutorial.stage.open_crew',
    ],
    note: "ui.crew.title='Crew'/'Équipe' and shell.rail.employees='Crew'/'Équipe' agree, and tutorial.stage.open_crew already correctly says 'Crew panel'/'panneau Équipe' — but tutorial.step2/step4/step13's body text still calls it the pre-redesign 'Employee panel'/'panneau des employés' (see src/ui/shell/ToolRail.ts comment: the redesign renamed Employees -> Crew).",
  },
  {
    concept: 'panel_fleet',
    en: { canonical: 'Fleet', forbiddenSynonyms: ['Vehicle panel', 'Vehicles panel'] },
    fr: { canonical: 'Flotte', forbiddenSynonyms: ['panneau des véhicules', 'panneau Véhicules'] },
    relevantKeys: [
      'ui.fleet.title', 'shell.rail.vehicles',
      'tutorial.step14', 'tutorial.step_haul', 'tutorial.stage.open_vehicles',
    ],
    note: "ui.fleet.title='Fleet'/'Flotte' and shell.rail.vehicles='Fleet'/'Flotte' agree (redesign renamed Vehicles -> Fleet, same as Crew above), but tutorial.step14 ('Vehicle panel'), tutorial.step_haul and tutorial.stage.open_vehicles ('Vehicles panel'/'panneau Véhicules') still use the pre-redesign name — and step14 vs. the other two even disagree with each other on singular/plural.",
  },
  {
    concept: 'panel_blast',
    en: { canonical: 'Blast Workshop', forbiddenSynonyms: ['Blast Plan panel', 'Blast Plan'] },
    fr: { canonical: 'Atelier de tir', forbiddenSynonyms: ['panneau du plan de tir', 'plan de tir'] },
    relevantKeys: ['ui.blast_workshop.title', 'shell.rail.blast', 'tutorial.step5', 'shortcuts.blast'],
    note: "The panel's actual rendered title (src/ui/panels/BlastWorkshop.ts) is ui.blast_workshop.title = 'Blast Workshop'/'Atelier de tir'. shell.rail.blast's short 'Blast'/'Minage' and tutorial.stage.open_blast's 'Blast panel'/'panneau Tir' are accepted abbreviations of that title (same pattern as Ops abbreviating Operations) and are NOT forbidden. Only the invented 'Blast Plan' wording — used in tutorial.step5 and duplicated in shortcuts.blast ('B: Blast Plan'/'B : Plan de tir') — names something that doesn't exist as a panel title in either locale.",
  },
  {
    concept: 'panel_build',
    en: { canonical: 'Build', forbiddenSynonyms: [] },
    fr: { canonical: 'Construction', forbiddenSynonyms: ['Construire', 'Bâtir'] },
    relevantKeys: ['ui.build.title', 'shell.rail.build', 'shortcuts.build', 'tutorial.stage.open_build'],
    note: "en.json already converges on 'Build' (ui.build.title, shell.rail.build, shortcuts.build, tutorial text). fr.json has three live wordings: ui.build.title='Construire', shell.rail.build='Bâtir', shortcuts.build='Bâtir', tutorial.stage.open_build='Construction' (already correct). 'Construction' is picked as canonical: it is the only noun form (every other rail/shortcut label — Contrats, Flotte, Équipe, Sondage, Minage, Paramètres — is a noun, not a verb), and it is a listed true French/English cognate elsewhere in this codebase (localeSharedValuesAllowlist.ts: ui.finances.category.construction='Construction').",
  },
  {
    concept: 'panel_contracts',
    en: { canonical: 'Contracts', forbiddenSynonyms: ['Deals'] },
    fr: { canonical: 'Contrats', forbiddenSynonyms: [] },
    relevantKeys: ['ui.contracts.title', 'shell.rail.contracts', 'tutorial.step12', 'tutorial.stage.open_contracts', 'shortcuts.contracts'],
    note: "fr.json already converges on 'Contrats' everywhere. en.json agrees everywhere except shell.rail.contracts='Deals' — a wholesale different word, not an abbreviation of 'Contracts', and not one of the two renames the redesign documented (ToolRail.ts's comment names only Crew and Fleet).",
  },
  {
    concept: 'panel_settings',
    en: { canonical: 'Settings', forbiddenSynonyms: ['Setup'] },
    fr: { canonical: 'Paramètres', forbiddenSynonyms: ['Réglages'] },
    relevantKeys: ['ui.settings.title', 'shell.rail.settings', 'menu.settings'],
    note: "ui.settings.title and menu.settings agree ('Settings'/'Paramètres') in both locales; shell.rail.settings alone diverges ('Setup'/'Réglages') in both locales. Same class of bug as panel_contracts — not a documented redesign rename.",
  },
] as const;

// ── Orphaned/dead keys ──────────────────────────────────────────────────────
//
// Found during the sweep by grepping `src/**/*.ts` for `t('<key>')` /
// `t(\`<key>...\`)` lookups: these keys are written in both locale files but
// never read by any code, and they carry stale terminology that collides
// with (or duplicates, inconsistently) the live canonical terms above.
// Recommendation is removal, not reconciliation, since reconciling text
// nothing displays just relocates the maintenance burden.

export interface OrphanKeyEntry {
  keys: string[];
  reason: string;
}

export const ORPHAN_KEYS: readonly OrphanKeyEntry[] = [
  {
    keys: ['vehicle.excavator.name', 'vehicle.bulldozer.name', 'vehicle.truck.name', 'vehicle.drill_rig.name'],
    reason:
      "Legacy per-vehicle name keys. The live vehicle catalog (src/core/entities/Vehicle.ts) only ever builds nameKeys of the form `vehicle.${role}.tier${n}` for the 5 VehicleRole values (building_destroyer, debris_hauler, drill_rig, rock_digger, rock_fragmenter) and reads type labels via `vehicle_type.${role}`; none of these four `.name` keys is referenced anywhere in src/. vehicle.excavator.name's fr value 'Pelleteuse' collides with the live vehicle_type.rock_digger fr value, also 'Pelleteuse' — the same French word naming two different vehicle roles.",
  },
  {
    keys: [
      'ui.toolbar.blast', 'ui.toolbar.contracts', 'ui.toolbar.build', 'ui.toolbar.vehicles',
      'ui.toolbar.employees', 'ui.toolbar.survey', 'ui.toolbar.settings', 'ui.toolbar.saves',
    ],
    reason:
      "Pre-redesign toolbar labels, superseded by shell.rail.* (src/ui/shell/ToolRail.ts, whose header comment says explicitly: 'Replaces the old vertical toolbar'). Zero references to the `ui.toolbar.*` prefix remain in src/. The dead prefix carries its own internally inconsistent terminology (e.g. fr ui.toolbar.blast='Tir', a third wording alongside shell.rail.blast='Minage' and ui.blast_workshop.title='Atelier de tir') that a naive full-file synonym sweep would otherwise try to reconcile.",
  },
] as const;

// ── Known text-correctness defects ──────────────────────────────────────────
//
// Not "many names, one concept" terminology drift — text that is simply
// wrong relative to the actual UI, or a straight typo. Listed individually
// so the test-writer has one concrete assertion target per defect.

export interface TextDefect {
  key: string;
  locale: 'en' | 'fr' | 'both';
  problem: string;
  expectedFix: string;
}

export const KNOWN_TEXT_DEFECTS: readonly TextDefect[] = [
  {
    key: 'tutorial.step1',
    locale: 'both',
    problem:
      "Says the speed controls are 'in the top-right corner' (en) / 'en haut à droite' (fr). src/ui/shell/TopBar.ts appends them as the 3rd element from the left (`this.root.append(this.balanceWrap, dayWrap, speedWrap, alertWrap, this.scoresEl, rightWrap)`), left of center in the top HUD bar, not the right.",
    expectedFix: "Reword both locales to describe the speed controls as being toward the left of the top bar (or 'near the balance/day display'), matching TopBar.ts's actual DOM order.",
  },
  {
    key: 'tutorial.step2',
    locale: 'fr',
    problem: "Uses 'Emboutez' (to dent/stamp) where 'Embauchez' (to hire) is meant.",
    expectedFix: "Embauchez un prospecteur ... (also apply role_surveyor's canonical fr term, 'prospecteur', in place of the current 'géomètre').",
  },
  {
    key: 'tutorial.step4',
    locale: 'fr',
    problem: "Uses 'Emboutez' where 'Embauchez' is meant.",
    expectedFix: 'Emboutez -> Embauchez.',
  },
  {
    key: 'tutorial.step11',
    locale: 'fr',
    problem: "Uses 'Emboutez' where 'Embauchez' is meant.",
    expectedFix: 'Emboutez -> Embauchez.',
  },
  {
    key: 'tutorial.step13',
    locale: 'fr',
    problem: "Uses 'Emboutez' where 'Embauchez' is meant.",
    expectedFix: 'Emboutez -> Embauchez.',
  },
] as const;

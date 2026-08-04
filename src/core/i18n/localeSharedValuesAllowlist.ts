// BlastSimulator2026 — Locale Shared Values Allowlist
// Keys whose en.json and fr.json values are legitimately identical (proper
// nouns, numbers-only strings, symbols) and must not be flagged as
// untranslated by the i18n parity check.
//
// Pure data — no side effects — so it is importable from Node scripts
// (scripts/check-i18n-parity.ts) and browser code alike.
//
// Admission rules — a key belongs here only if one of these holds:
//   1. Format-only: the value carries no translatable word ("{speed}×", "✏").
//   2. Brand or version string: the product's own name, not a phrase about it.
//   3. Endonym: a language picker names each language in that language, so the
//      English button reads "English" and the French one "Français" in both
//      locales. en.json already stores "Français" for the French button, which
//      is what makes this the file's own convention rather than an omission.
//   4. True cognate: the value is a real, correctly-spelled French word that
//      happens to match the English one ("Nuisance", "Total", "Expert").
//
// Fictional proper nouns are NOT admissible: the catalogs translate them with
// French puns (Shatternite → Fracassine, Sparkium → Étincelium), so an
// untranslated one sitting beside translated siblings is a bug. Neither are
// `event.*.title` or `event.*.opt#` — those always need real translation.

/** Dot-separated i18n keys allowed to hold byte-identical en/fr values. */
export const LOCALE_SHARED_VALUE_ALLOWLIST: string[] = [
  // ── Brand and version ──
  'game.title',        // "BlastSimulator2026"
  'game.version',      // "v0.1.0"
  'menu.title',        // "BlastSimulator 2026"

  // ── Format-only / symbol-only ──
  'hud.speed_x',           // "{speed}×"
  'ui.employees.task_time', // "{t}t"
  'ui.blast_workshop.drill.diameter', // "Ø"

  // ── Language picker endonyms ──
  'ui.settings.english', // "English"
  'ui.settings.french',  // "Français"

  // ── True French/English cognates ──
  'hud.scores.nuisance',        // "Nuisance"
  'score.nuisance',             // "Nuisance"
  'need.fatigue',               // "Fatigue"
  'ui.employees.fatigue',       // "Fatigue"
  'ui.employees.xp',            // "XP"
  'ui.employees.base_salary',   // "Base"
  'ui.employees.skill_bonus',   // "Bonus"
  'ui.employees.total_salary',  // "Total"
  'ui.employees.proficiency_4', // "Expert"
  'proficiency.2',              // "Novice"
  'proficiency.4',              // "Expert"
  'ui.vehicles.type',           // "Type"
  'ui.build.ramp_section',      // "Terrain"
  'ui.settings.audio',          // "Volume"
  'sandbox.field.biome',        // "Biome"
  'ui.blast_workshop.preview.row_fragments', // "Fragments"
  'ui.blast_workshop.preflight.stat_charge', // "Charge"
  'ui.blast_workshop.preflight.predicted_voxels', // "{count} voxels" — technical term, unchanged in French
  'ui.blast_workshop.preflight.predicted_locked_fragments', // "fragments — T2"
  'ui.blast_workshop.preflight.predicted_locked_projections', // "projections — T3"
  'ui.blast_workshop.report.stat_fragments', // "Fragments"
  'ui.blast_workshop.report.stat_volume', // "Volume"
  'ui.blast_workshop.report.stat_projections', // "Projections"
];

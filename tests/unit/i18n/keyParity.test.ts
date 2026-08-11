// BlastSimulator2026 — en.json / fr.json key parity + self-reference + value
// parity invariants (issue #492, section 1).
//
// Three independent checks over the raw locale JSON, not `t()`:
//   1. Key-set parity — en.json and fr.json declare exactly the same keys.
//      This is expected to already hold (both files are documented as
//      key-complete at 3219 keys each, after the issue #492 orphan-key
//      removal); it is pinned here as a regression guard, not a new
//      requirement.
//   2. Self-reference — no value equals its own dotted key path, the classic
//      "t() fell back to the key name" bug. Expected to already hold.
//   3. EN/FR value parity — no fr.json value is byte-identical to the
//      corresponding en.json value unless the key is on
//      LOCALE_SHARED_VALUE_ALLOWLIST (proper nouns, numeric/format-only
//      strings, endonyms, true cognates — see that file's admission rules).
//      Expected to already hold: issue #457 closed this gap and the
//      allowlist is the maintained record of legitimate exceptions.
//
// All three are expected to PASS on this branch already — they lock in
// existing-good behavior so it cannot silently regress while section 1's
// glossary/wording fixes land. The RED assertions for this issue live in
// glossaryConformance.test.ts and textAccuracy.test.ts.

import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { LOCALE_SHARED_VALUE_ALLOWLIST } from '../../../src/core/i18n/localeSharedValuesAllowlist.js';

const en: Record<string, string> = enLocale as Record<string, string>;
const fr: Record<string, string> = frLocale as Record<string, string>;

describe('en.json / fr.json — key-set parity', () => {
  it('every key in en.json is present in fr.json', () => {
    const enKeys = Object.keys(en);
    const frKeys = new Set(Object.keys(fr));
    const missing = enKeys.filter((k) => !frKeys.has(k)).sort();
    expect(missing, `keys present in en.json but missing from fr.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every key in fr.json is present in en.json', () => {
    const frKeys = Object.keys(fr);
    const enKeys = new Set(Object.keys(en));
    const missing = frKeys.filter((k) => !enKeys.has(k)).sort();
    expect(missing, `keys present in fr.json but missing from en.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('both locale files declare exactly the same key count, pinned to the current key-complete baseline', () => {
    // Baseline is 3241 (up from 3235): the Saved Plans block in the Drill step
    // (gap G6, `blast_plan save|load` had no UI at all) added 6 new
    // `ui.blast_workshop.drill.*` keys — saved_section, save_plan, plan_name,
    // load_plan, saved_plan_summary, no_saved_plans — all translated in
    // fr.json, not carried over in English.
    // Before that, baseline was 3235 (up from 3233): the vehicle "Move Here" selection-bar
    // action (gap G4, `vehicle move <id> to:<x,z>` had no button) added 2 new
    // keys — shell.selection.move_here and shell.selection.no_move_target —
    // both translated in fr.json, not carried over in English.
    // Before that, baseline was 3233 (up from 3228): the per-hole charge controls (gap G3,
    // `charge hole:<id> …` had no button) added 5 new
    // `ui.blast_workshop.charge.*` keys — holes_section, charge_hole,
    // hole_charged, hole_uncharged, no_holes — all translated in fr.json, not
    // carried over in English.
    // Before that, baseline was 3228 (down from 3234): the sandbox setup screen collapse
    // (#504) removed 10 `sandbox.*` keys for the deleted controls and added
    // 4 new ones — sandbox.field.difficulty, sandbox.difficulty.easy,
    // sandbox.difficulty.normal, sandbox.difficulty.hard — net -6, both
    // locale files updated together.
    // Before that, baseline was 3234 (up from 3232): the survey-overlay visibility toggle
    // (#496) added 2 new keys — ui.survey.overlay_toggle_tip and
    // shortcuts.survey_overlay — both already translated in fr.json, not
    // just carried over in English.
    // Before that, baseline was 3232 (up from 3221): the loading screen redesign (#493)
    // added 11 new `loading.*` keys for the eyebrow, subtitle, briefing,
    // stage row, and tip block — eyebrow_site, eyebrow_sandbox,
    // brief.starting_cash, brief.target, brief.explosives, sandbox_subtitle,
    // stage_label, stage_meta, tip_label, tip_next, tip_next_hint — all
    // already translated in fr.json, not just carried over in English.
    // Before that, baseline was 3221 (up from 3219): merging origin/main
    // (#489/#501, the tutorial-completability fix) brought in two new keys —
    // shell.placement.outside_region and shell.placement.pick_first — both
    // already translated in fr.json, not just carried over in English.
    // Before that, baseline was 3219 (down from 3231) after 12 dead/orphaned
    // keys were removed as part of the issue #492 glossary sweep — see
    // ORPHAN_KEYS in src/core/i18n/glossary.ts. Baseline is now 3244 (up from
    // 3241): #558 added shell.placement.refused_protected_ground,
    // refused_expansion_disabled and refused_too_far — the specific reasons a
    // site-claim preview can refuse a placement tile, both locales translated.
    // Update this baseline only alongside a deliberate key addition/removal,
    // not silently.
    expect(Object.keys(en).length).toBe(Object.keys(fr).length);
    expect(Object.keys(en).length).toBe(3244);
  });
});

describe('en.json / fr.json — no value self-references its own key', () => {
  it('no en.json value equals its own dotted key path', () => {
    const selfReferencing = Object.entries(en)
      .filter(([key, value]) => value === key)
      .map(([key]) => key)
      .sort();
    expect(
      selfReferencing,
      `en.json key(s) whose value is literally the key name (t() fallback leaked into content):\n${selfReferencing.join('\n')}`,
    ).toEqual([]);
  });

  it('no fr.json value equals its own dotted key path', () => {
    const selfReferencing = Object.entries(fr)
      .filter(([key, value]) => value === key)
      .map(([key]) => key)
      .sort();
    expect(
      selfReferencing,
      `fr.json key(s) whose value is literally the key name (t() fallback leaked into content):\n${selfReferencing.join('\n')}`,
    ).toEqual([]);
  });
});

describe('en.json / fr.json — no untranslated (byte-identical) value outside the allowlist', () => {
  /** Keys present in both locale files whose values are byte-identical. */
  function computeUntranslatedKeys(): string[] {
    const enKeys = new Set(Object.keys(en));
    const frKeys = new Set(Object.keys(fr));
    const shared = [...enKeys].filter((k) => frKeys.has(k));
    return shared.filter((k) => en[k] === fr[k]).sort();
  }

  it('every byte-identical en/fr key is on LOCALE_SHARED_VALUE_ALLOWLIST', () => {
    const untranslated = computeUntranslatedKeys();
    const allowlistSet = new Set(LOCALE_SHARED_VALUE_ALLOWLIST);
    const notAllowlisted = untranslated.filter((k) => !allowlistSet.has(k));

    expect(
      notAllowlisted,
      `${notAllowlisted.length} key(s) have byte-identical en/fr values but are not on ` +
        `LOCALE_SHARED_VALUE_ALLOWLIST — translate fr.json for these, or add them to the ` +
        `allowlist if legitimately shared (proper noun, number, symbol, endonym, true cognate):\n` +
        notAllowlisted.slice(0, 50).map((k) => `  ${k}: "${en[k]}"`).join('\n') +
        (notAllowlisted.length > 50 ? `\n  ...and ${notAllowlisted.length - 50} more` : ''),
    ).toEqual([]);
  });

  it('LOCALE_SHARED_VALUE_ALLOWLIST holds only keys that are actually still byte-identical', () => {
    const untranslatedSet = new Set(computeUntranslatedKeys());
    const staleEntries = LOCALE_SHARED_VALUE_ALLOWLIST.filter((k) => !untranslatedSet.has(k));
    expect(
      staleEntries,
      `key(s) on LOCALE_SHARED_VALUE_ALLOWLIST whose en/fr values now differ — remove from the allowlist:\n${staleEntries.join('\n')}`,
    ).toEqual([]);
  });
});

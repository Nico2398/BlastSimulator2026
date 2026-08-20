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
    // ORPHAN_KEYS in src/core/i18n/glossary.ts. Baseline was 3244 (up from
    // 3241): #558 added shell.placement.refused_protected_ground,
    // refused_expansion_disabled and refused_too_far — the specific reasons a
    // site-claim preview can refuse a placement tile, both locales translated.
    // Baseline is now 3252 (up from 3244): #548 added the Operations panel
    // Work Queue section's 8 ui.operations.work_queue* keys (header, empty
    // state, unclaimed/unknown holder labels, the three status labels, and
    // the cancel control), both locales translated.
    // Baseline is now 3254 (up from 3252): #550 added ui.crew.task_driving_to_task
    // and ui.crew.tag_driving_task for the vehicle-gated "driving to task"
    // activity state, both locales translated.
    // Baseline is now 3253 (down from 3254): #552 retired the Fleet panel's
    // manual Haul button (hauling is self-dispatching now) and removed its
    // now-dead ui.vehicles.haul key from both locales. tutorial.stage.vehicle_haul
    // was renamed to tutorial.stage.vehicle_watch in the same change, a 1-for-1
    // swap that leaves the count unaffected.
    // Baseline is now 3254 (up from 3253): #553 added
    // ui.blast_workshop.drill.status_ordered — the ORDERED status chip for a
    // hole still in state.plannedDrillHoles, awaiting its drill_hole action —
    // both locales translated.
    // Baseline is now 3263 (up from 3254): #553's tutorial fix adds three new
    // tutorial steps (build-driving-center, train-driller, buy-drill-rig-assign)
    // closing the deadlock where drill_hole's vehicle gate left the driller
    // hired but never licensed/equipped to drive a drill_rig — 9 new keys
    // (3 step text + 3 step title + 3 stage hint), both locales translated.
    // Baseline is now 3264 (up from 3263): train-driller's own stage sequence
    // jumped straight from opening the Crew panel to .bs-train-btn, but that
    // control only renders once CrewPanel's single-expansion model has the
    // driller's own row open -- an unreachable gate, not a difficulty setting.
    // tutorial.stage.expand_driller names the real intermediate click, in
    // both locales.
    // Baseline is now 3266 (up from 3264): #554 (charging is real work) added
    // ui.blast_workshop.charge.hole_ordered (the Loading… row state for a
    // charge still queued as a `charge_hole` action) and
    // ui.blast_workshop.preflight.warn_charge_loading (the Preflight modal's
    // warning when a targeted hole's charge is still loading), both locales
    // translated.
    // Baseline is now 3268 (up from 3266): #555 (ramp excavation is real
    // work) added ui.build.ramp_ordered (the ordering confirmation message
    // for a queued ramp) and ui.crew.action_dig_ramp_segment (the crew
    // panel's action label while an employee excavates a ramp segment),
    // both locales translated.
    // Baseline is now 3275 (up from 3268): #555's tutorial fix adds two new
    // tutorial steps (train-digger, buy-rock-digger-assign) closing the
    // box-cut deadlock the same way #553 closed drill-plan's -- their card
    // title/body keys (tutorial.step_traindigger[.title],
    // tutorial.step_buyrockdigger[.title]) plus three tutorial rail hint keys
    // (tutorial.stage.expand_digger, tutorial.stage.train_excavator,
    // tutorial.stage.vehicle_buy_rock_digger), both locales translated.
    // Baseline is now 3274 (down from 3275): removed the orphaned
    // ui.build.ramp_built key (#637 review) -- buildRampCommand switched to
    // ui.build.ramp_ordered when ordering a ramp became queued excavation
    // work instead of an instant carve, and nothing ever came to reference
    // ramp_built's "Ramp carved." text afterward.
    // Baseline is now 3273 (down from 3274): #618 retired the Fleet panel's
    // manual Break button (fragment_debris/boulder-breaking is self-dispatching
    // since #552, same as hauling) and removed its now-dead ui.vehicles.break
    // key from both locales.
    // Baseline is now 3277 (up from 3273): #633 added 4 new
    // blast.validation.* keys (charge_loading, missing_charge, missing_delay,
    // protected_position) so ValidationError.issue in BlastPlan.ts can carry
    // translation keys instead of raw English prose, both locales translated.
    // Update this baseline only alongside a deliberate key addition/removal,
    // not silently.
    expect(Object.keys(en).length).toBe(Object.keys(fr).length);
    expect(Object.keys(en).length).toBe(3277);
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

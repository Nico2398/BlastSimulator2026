// BlastSimulator2026 — Survey data types (SurveyMethod union and SurveyResult record)

/** The three supported methods for surveying a mining site. */
export type SurveyMethod = 'seismic' | 'core_sample' | 'aerial';

/** Runtime array of every valid SurveyMethod value. */
export const SURVEY_METHODS: SurveyMethod[] = ['seismic', 'core_sample', 'aerial'];

/**
 * The result produced when a survey is completed.
 *
 * `estimates` is a two-level map:  outer key = resource/zone label,
 * inner key = grade/sub-zone label, value = numeric estimate (e.g. proportion).
 *
 * `confidence` must be in [0, 1].
 */
export interface SurveyResult {
  /** Unique survey record identifier. */
  id: number;
  /** Method used to gather data. */
  method: SurveyMethod;
  /** World-space X coordinate of the survey centre. */
  centerX: number;
  /** World-space Z coordinate of the survey centre. */
  centerZ: number;
  /** Simulation tick on which the survey was completed. */
  completedTick: number;
  /** ID of the surveyor entity that performed the survey. */
  surveyorId: number;
  /** Nested numeric estimates keyed by resource then grade. */
  estimates: Record<string, Record<string, number>>;
  /** Confidence in the estimates, clamped to [0, 1]. */
  confidence: number;
}

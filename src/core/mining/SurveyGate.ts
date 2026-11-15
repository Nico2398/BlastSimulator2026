// Grade-gated survey methods and the depth each reads (#2279).
import type { SurveyMethod } from './SurveyCalc.js';
import {
  SURVEY_METHOD_UNLOCK_GRADE, SURVEY_SURFACE_BAND_M, SURVEY_SURFACE_CAPPED_METHODS, SURVEY_FULL_DEPTH_GRADE,
  SURVEY_DEPTH_BELOW_SURFACE, SURVEY_SEISMIC_GROUP_SIZE,
} from '../config/balance.js';
import { gradeName } from '../economy/MineGrade.js';
import { t } from '../i18n/I18n.js';

/** Null when the method is open (or grade is undefined: non-progression site); else the grade that opens it. */
export function surveyMethodGate(grade: number | undefined, method: SurveyMethod): { needed: number } | null {
  if (grade === undefined) return null;
  const needed = SURVEY_METHOD_UNLOCK_GRADE[method];
  return grade >= needed ? null : { needed };
}

/** Console refusal text for a locked method, naming the grades; null when open (or non-progression site). */
export function surveyMethodRefusal(grade: number | undefined, method: SurveyMethod): string | null {
  const gate = surveyMethodGate(grade, method);
  if (grade === undefined || gate === null) return null;
  return t('survey.method_locked', { current: gradeName(grade), needed: gradeName(gate.needed) });
}

/** Short lock label shown on a locked method card ("opens at G1 – Depth"). */
export function surveyMethodLockLabel(needed: number): string {
  return t('ui.survey.method_locked', { grade: `G${needed} – ${gradeName(needed)}` });
}

/** Metres below the surface a method reads at this grade; full depth when grade is undefined. */
export function surveyDepthM(method: SurveyMethod, grade: number | undefined): number {
  const full = SURVEY_DEPTH_BELOW_SURFACE[method];
  if (grade === undefined || grade >= SURVEY_FULL_DEPTH_GRADE) return full;
  if (!(SURVEY_SURFACE_CAPPED_METHODS as readonly SurveyMethod[]).includes(method)) return full;
  return Math.min(full, SURVEY_SURFACE_BAND_M + SURVEY_SEISMIC_GROUP_SIZE);
}

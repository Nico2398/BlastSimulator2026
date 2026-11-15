// Grade-gated survey methods and the depth each reads (#2279).
import type { SurveyMethod } from './SurveyCalc.js';

/** Null when the method is open (or grade is undefined: non-progression site); else the grade that opens it. */
export function surveyMethodGate(_grade: number | undefined, _method: SurveyMethod): { needed: number } | null {
  throw new Error('not implemented');
}

/** Console refusal text for a locked method, naming the grade that opens it; null when open. */
export function surveyMethodRefusal(_grade: number | undefined, _method: SurveyMethod): string | null {
  throw new Error('not implemented');
}

/** Short lock label shown on a locked method card ("opens at G1 – Depth"). */
export function surveyMethodLockLabel(_needed: number): string {
  throw new Error('not implemented');
}

/** Metres below the surface a method reads at this grade; full depth when grade is undefined. */
export function surveyDepthM(_method: SurveyMethod, _grade: number | undefined): number {
  throw new Error('not implemented');
}

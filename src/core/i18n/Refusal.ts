// BlastSimulator2026 — Locale-free refusal description carried by core results

/** Interpolation values for a translation key. */
export type RefusalParams = Record<string, string | number>;

/**
 * Optional translation hint a core refusal carries beside its English `error`.
 * Core stays locale-free; the console/UI layer translates `errorKey` with `errorParams`.
 */
export interface RefusalKey {
  errorKey?: string;
  errorParams?: RefusalParams;
}

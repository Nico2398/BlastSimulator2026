// BlastSimulator2026 — Explanation texts for the Blast Workshop and the blast report (#2168)
//
// What a hole-status chip, a drill setting, the stemming field and a blast-report stat do
// to the shot, translated through t(); every number is read from balance.ts or the core
// function that applies it. Callers attach the text with explainable() / chip().

export type HoleStatusKind = 'wet' | 'tubed' | 'dry' | 'ordered' | 'buried';
export type DrillFieldKind = 'spacing' | 'depth' | 'diameter';
export type ReportStatKind = 'cleared' | 'cracked' | 'fragments' | 'volume' | 'projections';

/** What a hole's status chip means for the charge in it. */
export function holeStatusExplain(_kind: HoleStatusKind): string {
  throw new Error('not implemented');
}

/** What changing a drill setting does to the pattern. */
export function drillFieldExplain(_field: DrillFieldKind): string {
  throw new Error('not implemented');
}

/** What the stemming column does to the shot. */
export function stemmingExplain(): string {
  throw new Error('not implemented');
}

/** What a blast-report stat counts and what it says about the shot. */
export function reportStatExplain(_stat: ReportStatKind): string {
  throw new Error('not implemented');
}

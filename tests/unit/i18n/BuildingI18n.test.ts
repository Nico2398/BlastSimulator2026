// BlastSimulator2026 — CH1.6: i18n key resolution tests for buildings, tiers, and courses
//
// Verifies that every key referenced by the building catalog, tier labels,
// and training course names resolves (i.e. returns a non-empty string that
// is not the key itself) in both 'en' and 'fr' locales.

import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { BUILDING_DEFS } from '../../../src/core/entities/Building.js';
import type { BuildingType, BuildingTier } from '../../../src/core/entities/Building.js';

const ALL_BUILDING_TYPES: BuildingType[] = [
  'driving_center', 'blasting_academy', 'management_office', 'geology_lab',
  'research_center', 'living_quarters', 'explosive_warehouse', 'freight_warehouse',
  'vehicle_depot',
];

const ALL_TIERS: BuildingTier[] = [1, 2, 3];

const LOCALES = ['en', 'fr'] as const;

beforeEach(() => {
  setLocale('en');
});

// ── Building type generic names ──────────────────────────────────────────────

describe('building generic name keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: building.<type>.name keys resolve for all 9 types`, () => {
      setLocale(locale);
      for (const type of ALL_BUILDING_TYPES) {
        const key = `building.${type}.name`;
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length).toBeGreaterThan(0);
      }
    });
  }
});

// ── Building tier-specific names (from BuildingDef.nameKey) ──────────────────

describe('building tier nameKeys from BUILDING_DEFS resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: every BUILDING_DEFS nameKey resolves`, () => {
      setLocale(locale);
      for (const type of ALL_BUILDING_TYPES) {
        for (const tier of ALL_TIERS) {
          const key = BUILDING_DEFS[type][tier].nameKey;
          const result = t(key);
          expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
          expect(result.length).toBeGreaterThan(0);
        }
      }
    });
  }
});

// ── Generic tier labels ───────────────────────────────────────────────────────

describe('generic tier label keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: building.tier.{1,2,3} resolve`, () => {
      setLocale(locale);
      for (const tier of ALL_TIERS) {
        const key = `building.tier.${tier}`;
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length).toBeGreaterThan(0);
      }
    });
  }
});

// ── Training course name keys ─────────────────────────────────────────────────

const COURSE_KEYS = [
  'course.driving.truck',
  'course.driving.excavator',
  'course.driving.drill_rig',
  'course.blasting',
  'course.management',
  'course.geology',
] as const;

describe('training course name keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all course.* keys resolve`, () => {
      setLocale(locale);
      for (const key of COURSE_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length).toBeGreaterThan(0);
      }
    });
  }
});

// ── en/fr parity ─────────────────────────────────────────────────────────────

describe('en.json and fr.json have matching keys for building/tier/course namespace', () => {
  it('building tier nameKeys resolve differently in en vs fr', () => {
    // Spot-check that translations differ between locales (not just passthrough)
    setLocale('en');
    const enName = t('building.driving_center.t1.name');
    setLocale('fr');
    const frName = t('building.driving_center.t1.name');
    expect(enName).not.toBe('building.driving_center.t1.name');
    expect(frName).not.toBe('building.driving_center.t1.name');
    expect(enName).not.toBe(frName);
  });

  it('tier labels resolve differently in en vs fr', () => {
    setLocale('en');
    const enTier = t('building.tier.1');
    setLocale('fr');
    const frTier = t('building.tier.1');
    expect(enTier).not.toBe('building.tier.1');
    expect(frTier).not.toBe('building.tier.1');
    expect(enTier).not.toBe(frTier);
  });

  it('course keys resolve differently in en vs fr', () => {
    setLocale('en');
    const enCourse = t('course.blasting');
    setLocale('fr');
    const frCourse = t('course.blasting');
    expect(enCourse).not.toBe('course.blasting');
    expect(frCourse).not.toBe('course.blasting');
    expect(enCourse).not.toBe(frCourse);
  });
});

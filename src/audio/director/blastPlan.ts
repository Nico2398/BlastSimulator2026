// BlastSimulator2026 — Blast timeline plan
// Everything a blast sounds like, as data: the crack, boom and sub-bass at t=0,
// the tail a moment after, a rain of debris binned from the fragment flights,
// secondary explosions, collapsing buildings, duds and one muted alert for
// casualties. Pure: it needs the blast's description and a random source, and
// returns cues with their start times; nothing here plays anything.

import type { OneShotId } from '../SoundCatalog.js';
import type { PlayOptions, WorldPoint } from '../AudioPlayer.js';
import type { AccidentRecord } from '../../core/entities/Damage.js';
import type { FragmentFlight } from '../../core/mining/BlastResolve.js';
import type { Random } from '../../core/math/Random.js';
import { BLAST_AUDIO_CONFIG } from '../../core/config/audio/game.js';
import { clamp } from '../engine/units.js';

/** What the plan needs of one fragment's flight. */
type BlastFlight = Pick<FragmentFlight, 'delayS' | 'durationS' | 'impactSpeed'> & { readonly to: WorldPoint };

/** What the plan needs of the blast report. Every part is optional: a blast without casualties has none. */
interface BlastReportView {
  readonly destroyedBuildings?: readonly WorldPoint[];
  readonly accidents?: readonly Pick<AccidentRecord, 'type'>[];
  readonly fizzledHoleIds?: readonly string[];
  readonly secondaryBlasts?: readonly (WorldPoint & { readonly explosivesKg: number })[];
}

/** The renderer's description of a blast, given at the moment the flash and shake start. */
export interface BlastInfo {
  readonly origin: WorldPoint;
  readonly holeCount: number;
  /** Total charge fired (kg); when omitted the director uses what it saw loaded. */
  readonly chargeKg?: number;
  readonly flights: readonly BlastFlight[];
  readonly report: BlastReportView | null;
}

export interface PlannedCue {
  /** Seconds after the blast. */
  readonly atS: number;
  readonly sound: OneShotId;
  readonly options: Omit<PlayOptions, 'delayS'>;
}

const CFG = BLAST_AUDIO_CONFIG;

/** 0..1: how big the blast is, from hole count and (when known) charge mass on a log scale. */
function blastIntensity(holeCount: number, chargeKg: number): number {
  const holes = clamp(Math.log1p(Math.max(holeCount, 0)) / Math.log1p(CFG.fullScaleHoles), 0, 1);
  if (chargeKg <= 0) return holes;
  const mass = clamp(Math.log1p(chargeKg) / Math.log1p(CFG.fullScaleChargeKg), 0, 1);
  return (holes + mass) / 2;
}

function mainBlastCues(info: BlastInfo, intensity: number, random: Random): PlannedCue[] {
  const boostDb = intensity * CFG.maxBoostDb;
  return [
    { atS: 0, sound: 'blast_crack', options: { at: info.origin, gainDb: boostDb, key: 'blast:crack' } },
    { atS: CFG.boomDelayS, sound: 'blast_boom', options: { at: info.origin, gainDb: boostDb, pitchCents: -intensity * CFG.boomPitchDropCents, key: 'blast:boom' } },
    { atS: 0, sound: 'blast_sub', options: { gainDb: boostDb, key: 'blast:sub' } },
    { atS: random.nextFloat(CFG.tailMinDelayS, CFG.tailMaxDelayS), sound: 'blast_tail', options: { gainDb: boostDb * CFG.tailBoostShare, key: 'blast:tail' } },
  ];
}

interface Bin {
  count: number;
  sumLandingS: number;
  sumSpeed: number;
  sumX: number;
  sumZ: number;
}

/** Group flights into a few dozen bins by landing time, so thousands of impacts become a rain of tens of sounds. */
function binFlights(flights: readonly BlastFlight[]): Bin[] {
  const landings = flights.map(f => f.delayS + f.durationS);
  const first = landings.reduce((a, b) => Math.min(a, b), Infinity);
  const span = landings.reduce((a, b) => Math.max(a, b), -Infinity) - first;
  const binCount = clamp(Math.round(flights.length / CFG.rain.flightsPerBin), CFG.rain.minBins, CFG.rain.maxBins);
  const bins: Bin[] = Array.from({ length: binCount }, () => ({ count: 0, sumLandingS: 0, sumSpeed: 0, sumX: 0, sumZ: 0 }));
  flights.forEach((flight, i) => {
    const landing = landings[i] ?? first;
    const index = span > 0 ? Math.min(binCount - 1, Math.floor(((landing - first) / span) * binCount)) : 0;
    const bin = bins[index];
    if (!bin) return;
    bin.count++;
    bin.sumLandingS += landing;
    bin.sumSpeed += flight.impactSpeed;
    bin.sumX += flight.to.x;
    bin.sumZ += flight.to.z;
  });
  return bins.filter(bin => bin.count > 0);
}

/**
 * One weighted impact per bin: loud where many fragments land together, so the
 * rain swells and thins with the real landing density; lower and heavier with
 * faster fragments. The loudest bin is as loud as the fragments-per-bin count
 * allows (a lone fragment is plain quiet), the others sit below it.
 */
function debrisRain(flights: readonly BlastFlight[]): PlannedCue[] {
  if (flights.length === 0) return [];
  const rain = CFG.rain;
  const bins = binFlights(flights);
  const maxCount = bins.reduce((most, bin) => Math.max(most, bin.count), 1);
  const ceilingDb = rain.baseDb + Math.min(10 * Math.log10(maxCount), rain.maxBoostDb);
  return bins.map((bin, i) => {
    const meanSpeed = bin.sumSpeed / bin.count;
    const light = bin.count <= rain.lightMaxCount && meanSpeed < rain.lightMaxSpeed;
    const gainDb = ceilingDb + Math.max(10 * Math.log10(bin.count / maxCount), rain.minRelativeDb);
    const drop = light ? 0 : clamp(meanSpeed / rain.impactSpeedRef, 0, 1) * rain.maxPitchDropCents + (bin.count >= rain.heavyCount ? rain.heavyExtraDropCents : 0);
    return {
      atS: Math.max(0, bin.sumLandingS / bin.count),
      sound: light ? 'debris_pebble' : 'debris_hit',
      options: { at: { x: bin.sumX / bin.count, z: bin.sumZ / bin.count }, gainDb, pitchCents: -drop, key: `blast:rain:${i}` },
    };
  });
}

function secondaryCues(report: BlastReportView, random: Random): PlannedCue[] {
  const config = CFG.secondary;
  return (report.secondaryBlasts ?? []).slice(0, config.maxCount).flatMap((blast, i) => {
    const atS = config.firstDelayS + i * config.spacingS + random.nextFloat(0, config.jitterS);
    const size = clamp(blast.explosivesKg / config.fullScaleKg, 0, 1);
    const gainDb = config.minGainDb + size * (config.maxGainDb - config.minGainDb);
    const at = { x: blast.x, z: blast.z };
    return [
      { atS, sound: 'blast_crack', options: { at, gainDb, pitchCents: config.crackPitchCents, key: `blast:secondary:crack:${i}` } },
      { atS: atS + config.crackDelayS, sound: 'blast_boom', options: { at, gainDb, pitchCents: config.boomPitchCents, key: `blast:secondary:boom:${i}` } },
    ] satisfies PlannedCue[];
  });
}

function consequenceCues(report: BlastReportView, origin: WorldPoint, random: Random): PlannedCue[] {
  const cues: PlannedCue[] = [];
  (report.destroyedBuildings ?? []).slice(0, CFG.demolish.maxCount).forEach((building, i) => {
    cues.push({
      atS: CFG.demolish.firstDelayS + i * CFG.demolish.spacingS,
      sound: 'building_demolished',
      options: { at: { x: building.x, z: building.z }, gainDb: CFG.demolish.gainDb, key: `blast:demolish:${i}` },
    });
  });
  const dudCount = Math.min((report.fizzledHoleIds ?? []).length, CFG.dud.maxCount);
  for (let i = 0; i < dudCount; i++) {
    const at = { x: origin.x + random.nextFloat(-CFG.dud.scatterM, CFG.dud.scatterM), z: origin.z + random.nextFloat(-CFG.dud.scatterM, CFG.dud.scatterM) };
    cues.push({ atS: CFG.dud.firstDelayS + i * CFG.dud.spacingS, sound: 'blast_dud', options: { at, gainDb: CFG.dud.gainDb, key: `blast:dud:${i}` } });
  }
  if ((report.accidents ?? []).some(a => a.type === 'death' || a.type === 'injury')) {
    cues.push({ atS: CFG.casualty.delayS, sound: 'notify_bad', options: { gainDb: CFG.casualty.gainDb, key: 'blast:casualty' } });
  }
  return cues;
}

/** The whole timeline of one blast, earliest first. */
export function planBlast(info: BlastInfo, chargeKg: number, random: Random): PlannedCue[] {
  const intensity = blastIntensity(info.holeCount, info.chargeKg ?? chargeKg);
  const cues = [
    ...mainBlastCues(info, intensity, random),
    ...debrisRain(info.flights),
    ...(info.report ? [...secondaryCues(info.report, random), ...consequenceCues(info.report, info.origin, random)] : []),
  ];
  return cues.sort((a, b) => a.atS - b.atS);
}

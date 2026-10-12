// BlastSimulator2026 — Synthetic blast
// A plausible description of a mid-size blast (what the renderer hands the game's
// blast audio): origin, hole count, a few hundred fragment flights scattered around
// it, and a report with a collapsed building, a dud, a secondary blast and an injury.
// Deterministic for a given random source.

import type { Random } from '../../core/math/Random.js';
import type { BlastInfo } from '../director/blastPlan.js';
import { LAB_BLAST_SHAPE } from '../../core/config/audio/lab.js';

export function syntheticBlast(random: Random): BlastInfo {
  const shape = LAB_BLAST_SHAPE;
  const flights = Array.from({ length: shape.flightCount }, () => {
    const radius = Math.sqrt(random.next()) * shape.scatterRadiusM;
    const angle = random.nextFloat(0, Math.PI * 2);
    return {
      // Thrown from the blast's origin to a resting place around it: every one of them moves.
      from: { x: shape.origin.x, y: 0, z: shape.origin.z },
      delayS: random.nextFloat(0, shape.maxLaunchDelayS),
      durationS: random.nextFloat(shape.minFlightS, shape.maxFlightS),
      impactSpeed: random.nextFloat(shape.minImpactSpeed, shape.maxImpactSpeed),
      to: { x: shape.origin.x + Math.cos(angle) * radius, y: 0, z: shape.origin.z + Math.sin(angle) * radius },
    };
  });
  return {
    origin: shape.origin,
    holeCount: shape.holeCount,
    chargeKg: shape.chargeKg,
    flights,
    report: {
      destroyedBuildings: [shape.destroyedBuilding],
      accidents: [{ type: 'injury' }],
      fizzledHoleIds: ['h-dud'],
      secondaryBlasts: [{ ...shape.secondary }],
    },
  };
}

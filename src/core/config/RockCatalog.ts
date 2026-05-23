export interface RockType {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
  readonly hardnessTier: number;
  readonly fractureThreshold: number;
  readonly energyAbsorption: 0;
  readonly density: 0;
  readonly porosity: number;
  readonly oreProbabilities: Readonly<Record<string, number>>;
  readonly color: string;
  readonly noiseFreq: number;
  readonly levelBias: number;
}

export function getRock(_id: string): RockType | undefined {
  return undefined;
}

export function getAllRocks(): readonly RockType[] {
  return [];
}

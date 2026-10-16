import type { PlacementKit } from './PlacementKit';

export type MovablePickKind = 'vehicle' | 'employee';

/** Arms a single-tile pick that moves a vehicle or employee; Confirm runs the kind's console command. */
export function armEntityMovePick(
  kit: PlacementKit,
  target: { kind: MovablePickKind; id: number; name: string; x: number; z: number },
  run: (command: string) => void,
): void {
  // TODO: implement
  void kit;
  void target;
  void run;
}

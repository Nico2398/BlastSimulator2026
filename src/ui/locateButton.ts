/** Camera distance used when a Locate button focuses the scene camera on an entity. */
export const LOCATE_CAMERA_DISTANCE = 15;

export interface LocateButtonOptions {
  title: string;
  size?: number;
  onClick: () => void;
}

/** Build a small icon button (data-action="locate") that focuses the camera on an entity. */
export function makeLocateButton(_opts: LocateButtonOptions): HTMLButtonElement {
  // TODO: implement
  return undefined as unknown as HTMLButtonElement;
}

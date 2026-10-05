import { el } from './dom.js';
import { iconEl } from './icons.js';

/** Camera distance used when a Locate button focuses the scene camera on an entity. */
export const LOCATE_CAMERA_DISTANCE = 15;

export interface LocateButtonOptions {
  title: string;
  size?: number;
  onClick: () => void;
}

/** Build a small icon button (data-action="locate") that focuses the camera on an entity. */
export function makeLocateButton(opts: LocateButtonOptions): HTMLButtonElement {
  const size = opts.size ?? 26;
  const btn = el('button', {
    attrs: {
      type: 'button',
      'data-action': 'locate',
      title: opts.title,
      'aria-label': opts.title,
      style: `width:${size}px;height:${size}px;flex:0 0 ${size}px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer`,
    },
    children: [iconEl('locate', Math.round(size / 2) - 1)],
  });
  btn.addEventListener('click', opts.onClick);
  return btn;
}

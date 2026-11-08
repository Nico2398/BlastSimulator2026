// BlastSimulator2026 — Generic "open this entity" links any panel can show (#2165).
// The inspector has its own link (inspectorWidgets.entityLink); panels outside it
// receive an EntityOpener from UIManager and build the same-looking links from it.

import { el } from './dom.js';

/** What a panel link can open in the inspector. */
export type OpenableKind = 'employee' | 'vehicle' | 'building' | 'hole';

/** The one entry point panels call: open the inspector on an entity, or centre the camera on a point. */
export interface EntityOpener {
  open(kind: OpenableKind, id: number): void;
  focus(x: number, z: number): void;
}

/** Look of every in-text link, the inspector's included. */
export const LINK_STYLE = 'border:0;background:transparent;padding:0;color:var(--bsx-info);cursor:pointer;text-decoration:underline;font:inherit';

/** A link that opens `kind` `id`; plain text when no opener is wired. */
export function openerLink(opener: EntityOpener | undefined, kind: OpenableKind, id: number, label: string): HTMLElement {
  void opener; void kind; void id; void label; void el;
  throw new Error('not implemented');
}

/** A link that centres the camera on (x, z); plain text when no opener is wired. */
export function coordLink(opener: EntityOpener | undefined, x: number, z: number, label: string): HTMLElement {
  void opener; void x; void z; void label;
  throw new Error('not implemented');
}

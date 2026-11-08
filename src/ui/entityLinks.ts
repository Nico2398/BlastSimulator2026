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

function linkButton(label: string): HTMLElement {
  const link = el('button', { text: label });
  link.style.cssText = LINK_STYLE;
  return link;
}

/** A link that opens `kind` `id`; plain text when no opener is wired. */
export function openerLink(opener: EntityOpener | undefined, kind: OpenableKind, id: number, label: string): HTMLElement {
  if (!opener) return el('span', { text: label });
  const link = linkButton(label);
  link.dataset['selectKind'] = kind;
  link.dataset['selectId'] = String(id);
  link.addEventListener('click', event => {
    event.stopPropagation();
    opener.open(kind, id);
  });
  return link;
}

/** A link that centres the camera on (x, z); plain text when no opener is wired. */
export function coordLink(opener: EntityOpener | undefined, x: number, z: number, label: string): HTMLElement {
  if (!opener) return el('span', { text: label });
  const link = linkButton(label);
  link.dataset['focusX'] = String(x);
  link.dataset['focusZ'] = String(z);
  link.addEventListener('click', event => {
    event.stopPropagation();
    opener.focus(x, z);
  });
  return link;
}

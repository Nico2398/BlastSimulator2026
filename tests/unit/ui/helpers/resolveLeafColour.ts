// Structural text-colour resolution (#1418). jsdom does not implement the
// cascade for var() values, so instead of getComputedStyle this walks the DOM
// the way a browser would and asks one question per text leaf: does anything
// on the way up give it a colour other than the UA default (black / buttontext)?
//
// A leaf resolves through, in order up its ancestor chain:
//   - an inline `color:` declaration (read from the raw style attribute, because
//     jsdom drops cssText declarations that mix in var()),
//   - a class that some stylesheet rule gives a `color`,
//   - a `.bsx-root` ancestor, but only when the stylesheet has a root colour rule.
// A form control (button/input/select/textarea) with none of the above BLOCKS
// inheritance — the UA gives it `buttontext` — unless the stylesheet carries a
// `.bsx-root` form-control `color: inherit` rule.

export type LeafColour =
  | { kind: 'inline'; value: string }
  | { kind: 'class'; value: string }
  | { kind: 'root-rule' }
  | { kind: 'default'; reason: string };

export interface StyleFacts {
  /** Classes that some rule gives a colour (last compound of the selector). */
  colourClasses: Set<string>;
  /** `.bsx-root { color }` exists. */
  rootColour: boolean;
  /** A `.bsx-root` rule targeting button/input/select/textarea sets `color: inherit`. */
  controlInherit: boolean;
}

const COLOUR_DECL = /(?<![-\w])color\s*:\s*([^;}]+)/;
const FORM_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const UA_DEFAULTS = new Set(['', 'black', '#000', '#000000', 'buttontext', 'canvastext', 'initial']);

/** Read the stylesheet text and extract the facts the resolver needs. */
export function readStyleFacts(css: string): StyleFacts {
  const facts: StyleFacts = { colourClasses: new Set(), rootColour: false, controlInherit: false };
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(stripped)) !== null) {
    const selectorList = m[1]!.trim();
    const decl = COLOUR_DECL.exec(m[2]!);
    if (!decl) continue;
    const value = decl[1]!.trim();
    for (const rawSel of selectorList.split(',')) {
      const sel = rawSel.trim();
      const flat = sel.replace(/:where\(([^)]*)\)/g, ' $1 ').replace(/\s+/g, ' ').trim();
      const isRootOnly = /^\.bsx-root$/.test(flat);
      if (isRootOnly && !UA_DEFAULTS.has(value) && value !== 'inherit') facts.rootColour = true;
      if (/\.bsx-root\b/.test(flat) && /\b(button|input|select|textarea)\b/.test(flat) && value === 'inherit') {
        facts.controlInherit = true;
      }
      const last = flat.split(/[\s>+~]+/).filter(Boolean).pop() ?? '';
      if (last === '*' || last.startsWith('.bsx-root')) continue;
      for (const c of last.matchAll(/\.([\w-]+)/g)) facts.colourClasses.add(c[1]!);
    }
  }
  return facts;
}

/** Collect all injected stylesheet text (tokens + panel styles) from the document. */
export function documentCss(): string {
  return [...document.querySelectorAll('style')].map(s => s.textContent ?? '').join('\n');
}

function inlineColour(node: Element): string | null {
  const style = node.getAttribute('style') ?? '';
  const m = COLOUR_DECL.exec(style);
  const viaAttr = m ? m[1]!.trim() : '';
  const viaProp = (node as HTMLElement).style?.color ?? '';
  const value = viaAttr || viaProp;
  return UA_DEFAULTS.has(value.toLowerCase()) ? null : value;
}

export function resolveLeafColour(leaf: Element, facts: StyleFacts): LeafColour {
  for (let n: Element | null = leaf; n; n = n.parentElement) {
    const inline = inlineColour(n);
    if (inline) return { kind: 'inline', value: inline };
    const cls = [...n.classList].find(c => facts.colourClasses.has(c));
    if (cls) return { kind: 'class', value: cls };
    if (n.classList.contains('bsx-root')) {
      return facts.rootColour
        ? { kind: 'root-rule' }
        : { kind: 'default', reason: 'bsx-root has no colour rule' };
    }
    if (FORM_TAGS.has(n.tagName) && !facts.controlInherit) {
      return { kind: 'default', reason: `<${n.tagName.toLowerCase()}> uses UA buttontext; no color:inherit rule` };
    }
  }
  return { kind: 'default', reason: 'no coloured or bsx-root ancestor' };
}

/** Elements that own at least one non-blank direct text node. */
export function textLeaves(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (e: Element): void => {
    const hasText = [...e.childNodes].some(c => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
    if (hasText && e.tagName !== 'STYLE' && e.tagName !== 'SCRIPT') out.push(e);
    for (const c of e.children) walk(c);
  };
  walk(root);
  return out;
}

/** One line per leaf that falls back to the UA default colour. */
export function defaultColourLeaves(root: Element, facts: StyleFacts): string[] {
  return textLeaves(root).flatMap(leaf => {
    const r = resolveLeafColour(leaf, facts);
    if (r.kind !== 'default') return [];
    const text = (leaf.textContent ?? '').trim().slice(0, 40);
    return [`<${leaf.tagName.toLowerCase()} class="${leaf.className}"> "${text}": ${r.reason}`];
  });
}

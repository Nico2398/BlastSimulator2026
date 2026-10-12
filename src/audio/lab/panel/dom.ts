// BlastSimulator2026 — Tiny DOM builder for the lab page
// Element creation without a framework: attributes as a plain record, children as nodes or text.

type Child = Node | string | null | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  for (const child of children) {
    if (child === null || child === false) continue;
    element.append(child);
  }
  return element;
}

interface SliderSpec {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** How the value is shown next to the slider. */
  readonly format: (value: number) => string;
  readonly onInput: (value: number) => void;
  readonly attrs?: Readonly<Record<string, string>>;
}

interface SliderHandle {
  readonly element: HTMLLabelElement;
  readonly input: HTMLInputElement;
  value(): number;
}

/** A labelled range slider with a live value readout. */
export function slider(spec: SliderSpec): SliderHandle {
  const input = h('input', {
    type: 'range', min: String(spec.min), max: String(spec.max), step: String(spec.step), value: String(spec.value), ...spec.attrs,
  });
  const readout = h('span', { class: 'readout' }, spec.format(spec.value));
  input.addEventListener('input', () => {
    const value = Number(input.value);
    readout.textContent = spec.format(value);
    spec.onInput(value);
  });
  const element = h('label', { class: 'slider' }, h('span', { class: 'caption' }, spec.label), input, readout);
  return { element, input, value: () => Number(input.value) };
}

/** A button that runs `onClick`. */
export function button(label: string, onClick: () => void, attrs: Readonly<Record<string, string>> = {}): HTMLButtonElement {
  const element = h('button', { type: 'button', ...attrs }, label);
  element.addEventListener('click', onClick);
  return element;
}

// BlastSimulator2026 — A GitHub Actions expression evaluator, for tests only.
//
// The pipeline's workflows decide identity and concurrency inside `${{ }}`
// expressions — a runner's `run-name`, its concurrency group — and every one of
// those decisions fails in silence when it is wrong: a group that resolves to
// the wrong name serialises nothing, a `run-name` that resolves to the wrong
// entity makes a live session invisible to the check that should see it.
// Matching the expression text proves it was written; evaluating it against an
// event payload proves what it says. This implements the subset of the
// language those expressions use, with GitHub's semantics:
//
// - `&&` / `||` return an operand, not a boolean, exactly as in JavaScript.
// - Falsy is `false`, `0`, `-0`, `''`, `null` and `NaN`; objects are truthy.
// - `==` / `!=` compare strings case-insensitively, and coerce mismatched
//   types to numbers.
// - `contains`, `startsWith` and `endsWith` are case-insensitive.
// - A missing property reads as `null`, never an error.
//
// Reference: docs.github.com/actions/reference/evaluate-expressions-in-workflows-and-actions

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

type Token =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'") {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= source.length) throw new Error('unterminated string literal');
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += source[i];
        i += 1;
      }
      tokens.push({ kind: 'string', value });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if ('()[].,!<>'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    const number = /^-?\d+(\.\d+)?/.exec(source.slice(i));
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i));
    if (ident) {
      tokens.push({ kind: 'ident', value: ident[0] });
      i += ident[0].length;
      continue;
    }
    throw new Error(`unexpected character ${JSON.stringify(ch)} at ${i}`);
  }
  return tokens;
}

const truthy = (value: Value): boolean =>
  !(value === null || value === false || value === 0 || value === '' || Number.isNaN(value));

const toNumber = (value: Value): number => {
  if (value === null) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value.trim() === '' ? 0 : Number(value);
  return NaN;
};

const toText = (value: Value): string => {
  if (value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

function looseEquals(left: Value, right: Value): boolean {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.toLowerCase() === right.toLowerCase();
  }
  if (typeof left === typeof right || left === null || right === null) {
    if (left === null || right === null) return left === right || toNumber(left) === toNumber(right);
    return left === right;
  }
  return toNumber(left) === toNumber(right);
}

const FUNCTIONS: Record<string, (...args: Value[]) => Value> = {
  contains: (search, item) =>
    Array.isArray(search)
      ? search.some((entry) => looseEquals(entry, item))
      : toText(search).toLowerCase().includes(toText(item).toLowerCase()),
  startsWith: (text, prefix) => toText(text).toLowerCase().startsWith(toText(prefix).toLowerCase()),
  endsWith: (text, suffix) => toText(text).toLowerCase().endsWith(toText(suffix).toLowerCase()),
  format: (template, ...args) =>
    toText(template)
      .replace(/\{\{/g, '\u0000')
      .replace(/\}\}/g, '\u0001')
      .replace(/\{(\d+)\}/g, (_, index: string) => toText(args[Number(index)] ?? null))
      .replace(/\u0000/g, '{')
      .replace(/\u0001/g, '}'),
};

/**
 * Evaluates one expression — the text inside `${{ }}` — against `contexts`
 * (`{ github: {...}, inputs: {...}, vars: {...} }`).
 */
export function evaluateExpression(source: string, contexts: Record<string, Value>): Value {
  const tokens = tokenize(source);
  let position = 0;

  const peek = (): Token | undefined => tokens[position];
  const isOp = (value: string) => peek()?.kind === 'op' && peek()!.value === value;
  const expectOp = (value: string) => {
    if (!isOp(value)) throw new Error(`expected ${value} at token ${position}`);
    position += 1;
  };

  const primary = (): Value => {
    const token = peek();
    if (!token) throw new Error('unexpected end of expression');
    position += 1;
    if (token.kind === 'string' || token.kind === 'number') return token.value;
    if (token.kind === 'op' && token.value === '(') {
      const inner = orExpr();
      expectOp(')');
      return inner;
    }
    if (token.kind === 'ident') {
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'null') return null;
      if (isOp('(')) {
        position += 1;
        const args: Value[] = [];
        while (!isOp(')')) {
          args.push(orExpr());
          if (isOp(',')) position += 1;
        }
        expectOp(')');
        const fn = FUNCTIONS[token.value];
        if (!fn) throw new Error(`unsupported function ${token.value}`);
        return fn(...args);
      }
      return contexts[token.value] ?? null;
    }
    throw new Error(`unexpected token ${JSON.stringify(token)}`);
  };

  const postfix = (): Value => {
    let value = primary();
    for (;;) {
      if (isOp('.')) {
        position += 1;
        const name = peek();
        if (name?.kind !== 'ident') throw new Error('expected a property name');
        position += 1;
        value = value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value[name.value] ?? null)
          : null;
      } else if (isOp('[')) {
        position += 1;
        const key = orExpr();
        expectOp(']');
        value = value !== null && typeof value === 'object'
          ? ((value as Record<string, Value>)[toText(key)] ?? null)
          : null;
      } else {
        return value;
      }
    }
  };

  const unary = (): Value => {
    if (isOp('!')) {
      position += 1;
      return !truthy(unary());
    }
    return postfix();
  };

  const comparison = (): Value => {
    let left = unary();
    while (['<', '<=', '>', '>='].some(isOp)) {
      const op = peek()!.value;
      position += 1;
      const right = unary();
      const a = toNumber(left);
      const b = toNumber(right);
      left = op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
    }
    return left;
  };

  const equality = (): Value => {
    let left = comparison();
    while (isOp('==') || isOp('!=')) {
      const op = peek()!.value;
      position += 1;
      const right = comparison();
      left = op === '==' ? looseEquals(left, right) : !looseEquals(left, right);
    }
    return left;
  };

  const andExpr = (): Value => {
    let left = equality();
    while (isOp('&&')) {
      position += 1;
      const right = equality();
      left = truthy(left) ? right : left;
    }
    return left;
  };

  function orExpr(): Value {
    let left = andExpr();
    while (isOp('||')) {
      position += 1;
      const right = andExpr();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  const result = orExpr();
  if (position !== tokens.length) throw new Error(`trailing tokens after position ${position}`);
  return result;
}

/** Evaluates a workflow value written as `${{ ... }}`, however it was folded. */
export function evaluateTemplate(template: string, contexts: Record<string, Value>): Value {
  const match = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(template);
  if (!match) throw new Error(`not a single \${{ }} expression: ${template.slice(0, 40)}`);
  return evaluateExpression(match[1]!, contexts);
}

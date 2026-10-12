// BlastSimulator2026 — Check command line
// Reads the arguments of `npm run sounds:check` into options, or says what is wrong.

import { isMixScenarioName, MIX_SCENARIO_NAMES, type MixScenarioName } from './mixTypes.js';

interface CheckOptions {
  /** Scenarios to render; all of them when none were named. */
  readonly scenarios: readonly MixScenarioName[];
  readonly outDir: string;
  readonly port: number;
  /** Give up waiting for the page after this long (s). */
  readonly timeoutS: number;
}

type ParsedCheckArgs =
  | { readonly kind: 'options'; readonly options: CheckOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string };

export const CHECK_USAGE = [
  'Usage: npm run sounds:check -- [--scenario <name>[,<name>]] [--out <dir>] [--port <n>] [--timeout <s>]',
  `  scenarios: ${MIX_SCENARIO_NAMES.join(', ')} (default: all)`,
  '  --out      directory for the rendered WAV files and report.json (default: a temp directory)',
  '  --port     dev server port (default 5173)',
  '  --timeout  seconds to wait for the page (default 900)',
].join('\n');

const DEFAULT_PORT = 5173;
const DEFAULT_TIMEOUT_S = 900;

function positiveNumber(flag: string, value: string | undefined): number | string {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : `${flag} needs a positive number`;
}

export function parseCheckArgs(argv: readonly string[], defaultOutDir: string): ParsedCheckArgs {
  const scenarios: MixScenarioName[] = [];
  let outDir = defaultOutDir;
  let port = DEFAULT_PORT;
  let timeoutS = DEFAULT_TIMEOUT_S;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] ?? '';
    const value = argv[i + 1];
    if (flag === '--help' || flag === '-h') return { kind: 'help' };
    if (flag === '--scenario') {
      if (!value || value.startsWith('--')) return { kind: 'error', message: '--scenario needs a name' };
      for (const name of value.split(',').filter(Boolean)) {
        if (!isMixScenarioName(name)) return { kind: 'error', message: `unknown scenario "${name}" (known: ${MIX_SCENARIO_NAMES.join(', ')})` };
        if (!scenarios.includes(name)) scenarios.push(name);
      }
      i++;
    } else if (flag === '--out') {
      if (!value || value.startsWith('--')) return { kind: 'error', message: '--out needs a directory' };
      outDir = value;
      i++;
    } else if (flag === '--port' || flag === '--timeout') {
      const parsed = positiveNumber(flag, value);
      if (typeof parsed === 'string') return { kind: 'error', message: parsed };
      if (flag === '--port') port = parsed;
      else timeoutS = parsed;
      i++;
    } else {
      return { kind: 'error', message: `unknown argument "${flag}"` };
    }
  }
  return { kind: 'options', options: { scenarios: scenarios.length > 0 ? scenarios : [...MIX_SCENARIO_NAMES], outDir, port, timeoutS } };
}

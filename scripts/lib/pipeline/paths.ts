/**
 * BlastSimulator2026 — What a set of changed paths owes
 *
 * Pure functions from a list of repository-relative paths to the verification
 * channels the change must run and the review sections the reviewer must apply.
 * The CLAUDE.md Verification Gate is the authority on channels; this module is
 * its mechanical reading, so a run spends no tokens re-deriving it and runs
 * nothing a change does not owe.
 *
 * @module pipeline/paths
 */

/** A test file the test-writer owns during the blind phase. */
export function isTestPath(path: string): boolean {
  return path.startsWith('tests/') || path.startsWith('scripts/scenario-defs/');
}

/** A Vitest file `tdd red` runs to prove RED. */
export function isVitestFile(path: string): boolean {
  return path.startsWith('tests/') && /\.test\.tsx?$/.test(path);
}

const CONTEXT_PREFIXES = [
  '.claude/',
  '.opencode/',
  '.github/skills/',
  '.github/agents/',
  '.github/prompts/',
  '.github/instructions/',
  '.github/copilot-instructions.md',
];

function isContextPath(path: string): boolean {
  return CONTEXT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isPipelineCodePath(path: string): boolean {
  return (
    path.startsWith('.github/workflows/') ||
    path.startsWith('.github/actions/') ||
    path.startsWith('.github/scripts/') ||
    path.startsWith('.claude/hooks/')
  );
}

const isTypeScript = (path: string): boolean => /\.(ts|tsx|mts|cts)$/.test(path);
const isCode = (path: string): boolean => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(path);
const isLocale = (path: string): boolean => path.startsWith('src/core/i18n/locales/');
const isBuildConfig = (path: string): boolean =>
  /^(package(-lock)?\.json|tsconfig[^/]*\.json|vite[^/]*\.config\.ts|vitest[^/]*\.config\.ts)$/.test(path) ||
  /^(scripts|tests)\/tsconfig\.json$/.test(path);

/**
 * Runtime-visible change: the player could see a difference. Owes the visual
 * channel, which belongs to the visual-tester and to CI's interaction shards,
 * never to `verify`.
 */
export function isPlayerFacing(path: string): boolean {
  return (
    path.startsWith('src/renderer/') ||
    path.startsWith('src/ui/') ||
    path.startsWith('public/') ||
    path.endsWith('.css') ||
    path.endsWith('.html') ||
    isLocale(path)
  );
}

/** A gameplay change that full command sequences must still play through. */
function owesScenarios(path: string): boolean {
  return (
    path.startsWith('src/core/') ||
    path.startsWith('src/console/') ||
    path.startsWith('scripts/scenario-defs/') ||
    path.startsWith('scripts/shared/') ||
    path === 'scripts/run-all-scenarios.ts' ||
    path.startsWith('scripts/run-all-scenarios')
  );
}

export type Channel = 'static' | 'logic' | 'scenario' | 'context' | 'i18n' | 'duplication';

/**
 * The command each channel runs. Order is the order `verify` runs them:
 * cheapest first, so a cheap red stops nothing but is reported before the
 * expensive ones start.
 *
 * `context` is `validate:context` plus the suites that read context files
 * (`tests/unit/config`, `tests/unit/lint`): a context-only change owes those,
 * not the whole 270-second suite.
 */
export const CHANNEL_COMMANDS: Record<Channel, string[][]> = {
  context: [
    ['npm', 'run', 'validate:context'],
    ['npx', 'vitest', 'run', 'tests/unit/config', 'tests/unit/lint', '--reporter=dot'],
  ],
  i18n: [['npm', 'run', 'check:i18n']],
  static: [['npm', 'run', 'typecheck']],
  duplication: [['npm', 'run', 'qualimetry:diff']],
  logic: [['npm', 'run', 'test', '--', '--reporter=dot']],
  scenario: [['npm', 'run', 'scenarios']],
};

export const CHANNEL_ORDER: Channel[] = ['context', 'i18n', 'static', 'duplication', 'logic', 'scenario'];

/**
 * The channels `verify` runs for these changed paths. `visual` is never in it:
 * screenshots are read by the visual-tester, and interaction mode is CI's.
 * `logic` subsumes `context`'s test half, so a change owing both runs the
 * suite once.
 */
export function channelsFor(paths: string[]): Channel[] {
  const owed = new Set<Channel>();
  for (const path of paths) {
    const context = isContextPath(path);
    if (isTypeScript(path) || isBuildConfig(path)) owed.add('static');
    if (isCode(path) || isBuildConfig(path) || (path.endsWith('.json') && !context)) owed.add('logic');
    if (isCode(path) && (path.startsWith('src/') || path.startsWith('scripts/'))) owed.add('duplication');
    if (owesScenarios(path)) owed.add('scenario');
    if (context) owed.add('context');
    if (isLocale(path) || path.startsWith('src/ui/')) owed.add('i18n');
  }
  return CHANNEL_ORDER.filter((channel) => owed.has(channel));
}

type ReviewSection =
  | 'acceptance'
  | 'tests'
  | 'architecture'
  | 'durability'
  | 'duplication'
  | 'i18n'
  | 'security'
  | 'context'
  | 'workflows';

/**
 * The reviewer checklist sections a diff owes. `acceptance` always applies;
 * every other section is skipped when nothing it inspects changed, which is
 * what keeps one reviewer as cheap as the narrowest of the five it replaced.
 */
export function reviewSectionsFor(paths: string[]): ReviewSection[] {
  const sections = new Set<ReviewSection>(['acceptance']);
  for (const path of paths) {
    const code = isCode(path) && !isContextPath(path);
    if (isTestPath(path) || (code && path.startsWith('src/'))) sections.add('tests');
    if (code) {
      sections.add('architecture');
      sections.add('duplication');
    }
    if (code && path.startsWith('src/core/')) sections.add('durability');
    if (path.startsWith('src/ui/') || isLocale(path) || path.startsWith('src/renderer/')) sections.add('i18n');
    const readsUntrustedInput = code && path.startsWith('src/') && /save|load|serial|parse|recording/i.test(path);
    if (isPipelineCodePath(path) || (code && path.startsWith('scripts/')) || readsUntrustedInput) {
      sections.add('security');
    }
    if (isContextPath(path)) sections.add('context');
    if (isPipelineCodePath(path)) sections.add('workflows');
  }
  const order: ReviewSection[] = [
    'acceptance', 'tests', 'architecture', 'durability', 'duplication', 'i18n', 'security', 'context', 'workflows',
  ];
  return order.filter((section) => sections.has(section));
}

/** Issue number a `<issue>-<runId>[-s<K>]` label belongs to. */
export function issueFromLabel(label: string): string {
  const match = /^(\d+)-/.exec(label);
  return match ? match[1]! : label;
}

/** A label is safe as a branch suffix, a directory name and a file name. */
export function isValidLabel(label: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(label);
}

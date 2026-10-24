/**
 * BlastSimulator2026 — A shell command reduced to a category safe to publish
 *
 * Run metrics leave the runner as an artifact and as a line on the
 * `agentic-metrics` branch of a public repository, and a command line can carry
 * anything a session typed — a token in a header, a path, a message. So a
 * command is never recorded as typed: it is mapped onto a fixed vocabulary
 * (an npm script this repository defines, a git or gh subcommand, a known tool)
 * and everything outside that vocabulary is `other`.
 *
 * @module metrics/bash-category
 */

const GIT_SUBCOMMANDS = new Set([
  'add', 'branch', 'checkout', 'cherry-pick', 'commit', 'diff', 'fetch', 'log', 'merge', 'pull', 'push',
  'rebase', 'reset', 'restore', 'rev-parse', 'show', 'stash', 'status', 'switch', 'worktree', 'ls-files',
  'merge-base', 'cat-file', 'grep', 'blame', 'tag', 'remote', 'config',
]);

const GH_COMMANDS = new Set(['pr', 'issue', 'run', 'api', 'label', 'workflow', 'repo', 'release', 'search']);

const TOOLS = new Set([
  'ls', 'cat', 'grep', 'rg', 'sed', 'awk', 'head', 'tail', 'find', 'wc', 'mkdir', 'rm', 'cp', 'mv', 'echo',
  'printf', 'sort', 'uniq', 'diff', 'jq', 'node', 'python3', 'python', 'curl', 'tsx', 'bash', 'sh', 'test',
  'touch', 'chmod', 'xargs', 'tee', 'date', 'sleep', 'ps', 'kill', 'which', 'du', 'df', 'tr', 'cut',
]);

/** The first simple command of a line, with a leading `cd … &&` and env assignments dropped. */
function firstCommand(command: string): string[] {
  const segments = command.split(/&&|\|\||;|\|/).map((segment) => segment.trim()).filter(Boolean);
  const meaningful = segments.find((segment) => !/^cd\s/.test(segment)) ?? '';
  return meaningful.split(/\s+/).filter((word) => !/^[A-Z_][A-Z0-9_]*=/.test(word));
}

/**
 * The category of one Bash command. `scripts` is the set of npm script names
 * this repository defines; an `npm run` of anything else is `npm run (other)`.
 */
export function bashCategory(command: string, scripts: ReadonlySet<string>): string {
  // npm's own flags (`npm run -s x`) say nothing about what ran.
  const raw = firstCommand(command);
  const words = raw[0] === 'npm' ? raw.filter((word, i) => i < 2 || !/^-[a-z]$|^--(silent|quiet)$/.test(word)) : raw;
  const [head, second, third] = words;
  if (head === undefined) return 'other';
  if (head === 'npm' && (second === 'run' || second === 'run-script')) {
    const script = words[2] ?? '';
    if (!scripts.has(script)) return 'npm run (other)';
    const sub = words[3] === '--' ? words[4] : undefined;
    if (script === 'long' && (sub === 'start' || sub === 'wait' || sub === 'status')) return `npm run long ${sub}`;
    if (script === 'pipeline' && sub !== undefined && /^[a-z-]+$/.test(sub)) {
      const action = sub === 'tdd' && /^[a-z]+$/.test(words[5] ?? '') ? ` ${words[5]}` : '';
      return `npm run pipeline ${sub}${action}`;
    }
    return `npm run ${script}`;
  }
  if (head === 'npm' && (second === 'test' || second === 'ci' || second === 'install')) return `npm ${second}`;
  if (head === 'npx') return /^[a-z@][a-z0-9@/._-]*$/.test(second ?? '') && second!.length < 40 ? `npx ${second}` : 'npx (other)';
  if (head === 'git') {
    const sub = second === '-C' ? words[3] : second;
    return sub !== undefined && GIT_SUBCOMMANDS.has(sub) ? `git ${sub}` : 'git (other)';
  }
  if (head === 'gh') {
    if (second === undefined || !GH_COMMANDS.has(second)) return 'gh (other)';
    return /^[a-z-]+$/.test(third ?? '') ? `gh ${second} ${third}` : `gh ${second}`;
  }
  return TOOLS.has(head) ? head : 'other';
}

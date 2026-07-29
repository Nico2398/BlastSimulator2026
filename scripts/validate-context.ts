/**
 * BlastSimulator2026 — Context file validator
 *
 * Agent, skill, command, and rule frontmatter fails silently: an unrecognised
 * field is ignored rather than rejected, so a tool restriction or a preloaded
 * skill can quietly stop applying. This validator turns those silent failures
 * into errors.
 *
 * Checks:
 *   1. Frontmatter keys belong to the schema for that file type
 *   2. Tool names in `tools` / `disallowedTools` resolve to real Claude Code tools
 *   3. `skills:` entries reference skills that exist
 *   4. Hook commands point at files that exist and are executable, and the hooks
 *      that only work when registered project-wide are registered in settings.json
 *   5. Skill directory name matches its frontmatter `name`
 *   6. Body content is identical across .claude/, .github/, and .opencode/
 *   7. A command's `agent:` resolves to an agent that exists
 *   8. Every command has a mirror in the other two runtimes
 *   9. Files bundled with a skill are mirrored too, and named by their SKILL.md
 *  10. Each runtime's entry point states the same gates, channels, and skills
 *
 * Usage:
 *   npx tsx scripts/validate-context.ts
 *   npx tsx scripts/validate-context.ts --json
 *
 * @module validate-context
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

/** Frontmatter fields Claude Code recognises on a subagent definition. */
const AGENT_FIELDS = new Set([
  'name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode',
  'maxTurns', 'skills', 'mcpServers', 'hooks', 'memory', 'background', 'effort',
  'isolation', 'color', 'initialPrompt',
]);

/** Frontmatter fields Claude Code recognises on a skill or a slash command. */
const SKILL_FIELDS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments',
  'disable-model-invocation', 'user-invocable', 'allowed-tools', 'disallowed-tools',
  'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell',
]);

/** Frontmatter fields recognised on a path-scoped rule. */
const RULE_FIELDS = new Set(['paths']);

/** Built-in tools available to a subagent. */
const TOOLS = new Set([
  'Read', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'Glob', 'Bash', 'PowerShell',
  'WebFetch', 'WebSearch', 'TodoWrite', 'Skill', 'ToolSearch', 'Agent', 'Artifact',
  'Monitor', 'SendMessage', 'TaskStop', 'EnterWorktree', 'ExitWorktree',
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate',
]);

export interface ContextIssue {
  file: string;
  message: string;
}

interface ParsedFile {
  path: string;
  /** Raw frontmatter text, without the `---` fences. */
  frontmatter: string;
  /** Everything after the closing fence. */
  body: string;
}

function parse(path: string): ParsedFile | undefined {
  const text = readFileSync(path, 'utf8');
  if (!text.startsWith('---\n')) {
    return undefined;
  }
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) {
    return undefined;
  }
  return { path, frontmatter: text.slice(4, end + 1), body: text.slice(end + 5) };
}

/** Top-level keys of a frontmatter block. Nested keys are indented, so skipped. */
function topLevelKeys(frontmatter: string): string[] {
  return frontmatter
    .split('\n')
    .filter((line) => /^[A-Za-z_-]+:/.test(line))
    .map((line) => line.slice(0, line.indexOf(':')));
}

/** Values of an inline list field (`tools: A, B`) or a YAML block list. */
function listField(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) {
    return [];
  }
  const inline = lines[index]!.slice(key.length + 1).trim();
  if (inline) {
    return inline.split(/[,\s]+/).filter(Boolean);
  }
  const items: string[] = [];
  for (const line of lines.slice(index + 1)) {
    const match = /^\s+-\s*(.+)$/.exec(line);
    if (!match) break;
    items.push(match[1]!.trim().replace(/^["']|["']$/g, ''));
  }
  return items;
}

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f));
}

function skillNames(): Set<string> {
  const dir = join(ROOT, '.claude/skills');
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((entry) => existsSync(join(dir, entry, 'SKILL.md'))));
}

/** Agent names as declared in frontmatter, which need not match the filename. */
function agentNames(): Set<string> {
  const names = new Set<string>();
  for (const path of markdownFiles(join(ROOT, '.claude/agents'))) {
    const file = parse(path);
    const name = file && listField(file.frontmatter, 'name')[0];
    if (name) names.add(name);
  }
  return names;
}

/**
 * A command's `agent:` must name an agent that exists. Renaming an agent
 * without updating its commands leaves them pointing at nothing, and the
 * command silently runs in the default agent instead of the one it declared.
 */
function checkCommand(file: ParsedFile, agents: Set<string>): ContextIssue[] {
  const issues = checkUnknownFields(file, SKILL_FIELDS, 'command');
  const agent = listField(file.frontmatter, 'agent')[0];
  if (agent && !agents.has(agent)) {
    issues.push({
      file: file.path,
      message: `\`agent\` names unknown agent \`${agent}\` — the command falls back to the default agent`,
    });
  }
  return issues;
}

function checkUnknownFields(file: ParsedFile, allowed: Set<string>, kind: string): ContextIssue[] {
  return topLevelKeys(file.frontmatter)
    .filter((key) => !allowed.has(key))
    .map((key) => ({
      file: file.path,
      message: `unknown ${kind} frontmatter field \`${key}\` — silently ignored by Claude Code`,
    }));
}

function checkAgent(file: ParsedFile, skills: Set<string>): ContextIssue[] {
  const issues = checkUnknownFields(file, AGENT_FIELDS, 'agent');
  const keys = new Set(topLevelKeys(file.frontmatter));

  for (const required of ['name', 'description']) {
    if (!keys.has(required)) {
      issues.push({ file: file.path, message: `missing required agent field \`${required}\`` });
    }
  }

  for (const key of ['tools', 'disallowedTools']) {
    for (const tool of listField(file.frontmatter, key)) {
      if (!TOOLS.has(tool) && !tool.startsWith('mcp__')) {
        issues.push({ file: file.path, message: `\`${key}\` names unknown tool \`${tool}\`` });
      }
    }
  }

  for (const skill of listField(file.frontmatter, 'skills')) {
    if (!skills.has(skill)) {
      issues.push({ file: file.path, message: `\`skills\` preloads missing skill \`${skill}\`` });
    }
  }

  for (const match of file.frontmatter.matchAll(/command:\s*(\S+)/g)) {
    const command = match[1]!.replace('${CLAUDE_PROJECT_DIR}/', '');
    const path = join(ROOT, command);
    if (!existsSync(path)) {
      issues.push({ file: file.path, message: `hook command not found: ${command}` });
    } else if (!(statSync(path).mode & 0o111)) {
      issues.push({ file: file.path, message: `hook command not executable: ${command}` });
    }
  }

  return issues;
}

function checkSkill(file: ParsedFile, skills: Set<string>): ContextIssue[] {
  const issues = checkUnknownFields(file, SKILL_FIELDS, 'skill');
  const dirName = basename(join(file.path, '..'));
  const name = listField(file.frontmatter, 'name')[0];

  if (name && name !== dirName) {
    issues.push({ file: file.path, message: `frontmatter name \`${name}\` differs from directory \`${dirName}\`` });
  }
  if (!/description:/.test(file.frontmatter)) {
    issues.push({ file: file.path, message: 'missing `description` — Claude cannot match the skill to a task' });
  }
  for (const referenced of listField(file.frontmatter, 'skills')) {
    if (!skills.has(referenced)) {
      issues.push({ file: file.path, message: `references missing skill \`${referenced}\`` });
    }
  }
  return issues;
}

/** The file each runtime loads on every session. */
const ENTRY_POINTS = [
  '.claude/CLAUDE.md',
  '.github/copilot-instructions.md',
  '.opencode/AGENTS.md',
];

/** Sections every entry point carries, matched on the stable part of the heading. */
const ENTRY_SECTIONS = [
  'Autonomous pipeline sessions',
  'Verification Gate',
  'Capability Gate',
  'Validation Commands',
];

/** Verification channels every entry point names. */
const CHANNELS = ['static', 'logic', 'scenario', 'visual', 'playability'];

/**
 * Entry points are the only layer loaded on every session, and each runtime
 * holds its own. Their wording legitimately diverges — Claude Code has vision
 * and a `rules/` layer, the other two inline what those rules say — so the
 * bodies cannot be diffed the way skill bodies are. What must never diverge is
 * what they promise: the same gates, the same verification channels, and skill
 * names that still resolve. A channel one runtime forgets to name is a channel
 * that runtime silently stops running.
 */
function checkEntryPoints(skills: Set<string>): ContextIssue[] {
  const issues: ContextIssue[] = [];

  for (const relative of ENTRY_POINTS) {
    const path = join(ROOT, relative);
    if (!existsSync(path)) {
      issues.push({ file: path, message: 'missing runtime entry point' });
      continue;
    }

    const text = readFileSync(path, 'utf8');
    const headings = text.split('\n').filter((line) => line.startsWith('## ')).join('\n');

    for (const section of ENTRY_SECTIONS) {
      if (!headings.includes(section)) {
        issues.push({
          file: path,
          message: `no \`${section}\` section — this runtime lacks a gate the others state`,
        });
      }
    }

    for (const channel of CHANNELS) {
      if (!text.includes(`\`${channel}\``)) {
        issues.push({
          file: path,
          message: `verification channel \`${channel}\` unnamed — this runtime would skip it`,
        });
      }
    }

    const unknown = new Set(
      [...text.matchAll(/`((?:gameplay|dev|agentic)-[a-z-]+)`/g)]
        .map((match) => match[1]!)
        .filter((name) => !skills.has(name))
    );
    for (const name of unknown) {
      issues.push({ file: path, message: `references missing skill \`${name}\`` });
    }
  }

  return issues;
}

/** Paths under a skill directory, relative to it, excluding its SKILL.md. */
function bundledFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(join(dir, entry)).isDirectory()) {
      found.push(...bundledFiles(join(dir, entry), relative));
    } else if (relative !== 'SKILL.md') {
      found.push(relative);
    }
  }
  return found;
}

/**
 * A skill splits its detail into bundled files so the agent loads only what the
 * step needs. Two ways that fails silently: a file the SKILL.md never names is
 * context nothing reaches, and a file mirrored into one runtime only gives that
 * runtime knowledge the others lack.
 */
function checkBundledFiles(skill: string, body: string): ContextIssue[] {
  const issues: ContextIssue[] = [];
  const claudeDir = join(ROOT, '.claude/skills', skill);

  for (const relative of bundledFiles(claudeDir)) {
    if (!body.includes(relative)) {
      issues.push({
        file: join(claudeDir, relative),
        message: 'not named by its SKILL.md — nothing tells an agent to read it',
      });
    }
    const source = readFileSync(join(claudeDir, relative), 'utf8');
    for (const dir of ['.github/skills', '.opencode/skills']) {
      const mirror = join(ROOT, dir, skill, relative);
      if (!existsSync(mirror)) {
        issues.push({ file: mirror, message: `missing mirror of ${skill}/${relative}` });
      } else if (readFileSync(mirror, 'utf8').trim() !== source.trim()) {
        issues.push({ file: mirror, message: `differs from .claude/skills/${skill}/${relative}` });
      }
    }
  }

  for (const dir of ['.github/skills', '.opencode/skills']) {
    for (const relative of bundledFiles(join(ROOT, dir, skill))) {
      if (!existsSync(join(claudeDir, relative))) {
        issues.push({
          file: join(ROOT, dir, skill, relative),
          message: `has no counterpart in .claude/skills/${skill}/`,
        });
      }
    }
  }

  return issues;
}

/** Bodies must match across runtimes; frontmatter is allowed to differ. */
function checkCrossRuntimeSync(): ContextIssue[] {
  const issues: ContextIssue[] = [];

  for (const skill of skillNames()) {
    const claude = parse(join(ROOT, '.claude/skills', skill, 'SKILL.md'));
    if (!claude) continue;
    for (const mirror of [
      join(ROOT, '.github/skills', skill, 'SKILL.md'),
      join(ROOT, '.opencode/skills', skill, 'SKILL.md'),
    ]) {
      if (!existsSync(mirror)) {
        issues.push({ file: mirror, message: `missing mirror of skill \`${skill}\`` });
        continue;
      }
      const other = parse(mirror);
      if (other && other.body.trim() !== claude.body.trim()) {
        issues.push({ file: mirror, message: `body differs from .claude/skills/${skill}/SKILL.md` });
      }
    }
    issues.push(...checkBundledFiles(skill, claude.body));
  }

  for (const path of markdownFiles(join(ROOT, '.claude/agents'))) {
    const claude = parse(path);
    if (!claude) continue;
    const stem = basename(path, '.md');
    for (const mirror of [
      join(ROOT, '.github/agents', `${stem}.agent.md`),
      join(ROOT, '.opencode/agents', `${stem}.md`),
    ]) {
      if (!existsSync(mirror)) {
        issues.push({ file: mirror, message: `missing mirror of agent \`${stem}\`` });
        continue;
      }
      const other = parse(mirror);
      if (other && other.body.trim() !== claude.body.trim()) {
        issues.push({ file: mirror, message: `body differs from .claude/agents/${stem}.md` });
      }
    }
  }

  // Commands are checked for existence, not body equality: each runtime spells
  // its arguments differently (`$ARGUMENTS` vs `${input:name}`), so identical
  // bodies are not achievable. A missing mirror means one runtime silently
  // lacks an entry point the others have.
  for (const path of markdownFiles(join(ROOT, '.claude/commands'))) {
    const stem = basename(path, '.md');
    for (const mirror of [
      join(ROOT, '.github/prompts', `${stem}.prompt.md`),
      join(ROOT, '.opencode/commands', `${stem}.md`),
    ]) {
      if (!existsSync(mirror)) {
        issues.push({ file: mirror, message: `missing mirror of command \`${stem}\`` });
      }
    }
  }

  return issues;
}

/** Hooks that must be registered in settings.json, not in agent frontmatter. */
const SETTINGS_HOOKS = [
  {
    script: '.claude/hooks/require-foreground-agents.sh',
    event: 'PreToolUse',
    /** Tool names the matcher has to cover for the guard to see a delegation. */
    tools: ['Agent', 'Task'],
    why:
      'a frontmatter declaration only registers for agents started through the `Agent` ' +
      'tool, and the orchestrator is entered by `/agentic-run` forking into it — so the ' +
      'guard never ran, and issue #406 lost its run to a backgrounded sub-agent',
  },
];

/**
 * Checks `.claude/settings.json` hooks.
 *
 * A hook file that exists and is executable still does nothing until something
 * registers it, and `checkAgent` above only proves the first half. Registration
 * is where this project has been bitten: `require-foreground-agents.sh` passed
 * every check while sitting inert, because it was declared in the one place the
 * orchestrator's session never reads.
 */
function checkSettingsHooks(): ContextIssue[] {
  const relative = '.claude/settings.json';
  const path = join(ROOT, relative);
  if (!existsSync(path)) {
    return [{ file: relative, message: 'missing — project hooks and permissions live here' }];
  }

  let settings: { hooks?: Record<string, { matcher?: string; hooks?: { command?: string }[] }[]> };
  try {
    settings = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return [{ file: relative, message: `is not valid JSON: ${(error as Error).message}` }];
  }

  const issues: ContextIssue[] = [];
  const hooks = settings.hooks ?? {};

  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks ?? []) {
        const command = (hook.command ?? '').replace('${CLAUDE_PROJECT_DIR}/', '');
        if (!command) continue;
        const target = join(ROOT, command);
        if (!existsSync(target)) {
          issues.push({ file: relative, message: `${event} hook command not found: ${command}` });
        } else if (!(statSync(target).mode & 0o111)) {
          issues.push({ file: relative, message: `${event} hook command not executable: ${command}` });
        }
      }
    }
  }

  for (const required of SETTINGS_HOOKS) {
    const entries = hooks[required.event] ?? [];
    const registered = entries.filter((entry) =>
      (entry.hooks ?? []).some((hook) => (hook.command ?? '').endsWith(basename(required.script)))
    );
    if (registered.length === 0) {
      issues.push({
        file: relative,
        message: `${required.script} is not registered as a ${required.event} hook — ${required.why}`,
      });
      continue;
    }
    for (const tool of required.tools) {
      const covered = registered.some((entry) => {
        const matcher = entry.matcher ?? '';
        if (!matcher || matcher === '*') return true;
        try {
          return new RegExp(matcher).test(tool);
        } catch {
          return false;
        }
      });
      if (!covered) {
        issues.push({
          file: relative,
          message:
            `${required.script} is registered for ${required.event} but its matcher does not ` +
            `match the \`${tool}\` tool`,
        });
      }
    }
  }

  return issues;
}

/**
 * Validates every context file under `.claude/`, plus cross-runtime body sync.
 *
 * @returns All issues found; empty when the context tree is valid.
 */
export function validateContextFiles(): ContextIssue[] {
  const skills = skillNames();
  const issues: ContextIssue[] = [];

  for (const path of markdownFiles(join(ROOT, '.claude/agents'))) {
    const file = parse(path);
    if (!file) {
      issues.push({ file: path, message: 'missing YAML frontmatter' });
      continue;
    }
    issues.push(...checkAgent(file, skills));
  }

  for (const skill of skills) {
    const file = parse(join(ROOT, '.claude/skills', skill, 'SKILL.md'));
    if (!file) {
      issues.push({ file: join('.claude/skills', skill, 'SKILL.md'), message: 'missing YAML frontmatter' });
      continue;
    }
    issues.push(...checkSkill(file, skills));
  }

  const agents = agentNames();
  for (const path of markdownFiles(join(ROOT, '.claude/commands'))) {
    const file = parse(path);
    if (file) {
      issues.push(...checkCommand(file, agents));
    }
  }

  for (const path of markdownFiles(join(ROOT, '.claude/rules'))) {
    const file = parse(path);
    if (file) {
      issues.push(...checkUnknownFields(file, RULE_FIELDS, 'rule'));
    }
  }

  issues.push(...checkEntryPoints(skills));
  issues.push(...checkSettingsHooks());
  issues.push(...checkCrossRuntimeSync());
  return issues;
}

function main(): void {
  const issues = validateContextFiles();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ issues }, null, 2));
  } else if (issues.length === 0) {
    console.log(
      'Context files valid: frontmatter schemas, tool names, preloaded skills, hooks, ' +
        'settings.json hook registration, bundled skill files, runtime entry points, ' +
        'cross-runtime sync.'
    );
  } else {
    console.error(`${issues.length} context file issue(s):\n`);
    for (const issue of issues) {
      console.error(`  ${issue.file.replace(`${ROOT}/`, '')}`);
      console.error(`    ${issue.message}`);
    }
  }

  process.exit(issues.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main();
}

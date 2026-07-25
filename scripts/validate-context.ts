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
 *   4. Hook commands point at files that exist and are executable
 *   5. Skill directory name matches its frontmatter `name`
 *   6. Body content is identical across .claude/, .github/, and .opencode/
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

  for (const path of markdownFiles(join(ROOT, '.claude/commands'))) {
    const file = parse(path);
    if (file) {
      issues.push(...checkUnknownFields(file, SKILL_FIELDS, 'command'));
    }
  }

  for (const path of markdownFiles(join(ROOT, '.claude/rules'))) {
    const file = parse(path);
    if (file) {
      issues.push(...checkUnknownFields(file, RULE_FIELDS, 'rule'));
    }
  }

  issues.push(...checkCrossRuntimeSync());
  return issues;
}

function main(): void {
  const issues = validateContextFiles();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ issues }, null, 2));
  } else if (issues.length === 0) {
    console.log('Context files valid: frontmatter schemas, tool names, preloaded skills, hooks, cross-runtime sync.');
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

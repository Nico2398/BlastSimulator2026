// PreCompact hook — decide when the lead's automatic compaction may run.
//
// Registered in `.claude/settings.json`. The runner's small auto-compact
// window only makes Claude Code start asking early; every ask comes here, and
// Claude Code asks again on each request it is refused. The policy:
//
//   inside a step                        refuse, unless the prompt reached MID_STEP_VALVE
//   at a boundary, the next step heavy   allow when the prompt reached HEAVY_FLOOR
//   at a boundary, otherwise             allow when the prompt reached NEAR_FULL
//
// A boundary is the first BOUNDARY_REQUESTS requests after
// `npm run pipeline -- step` wrote `.agentic/step.json`; `--heavy` marks the
// step ahead as heavy. Manual `/compact`, sub-agents, sessions with no step
// marker, and a transcript ending on an API error keep Claude Code's own rule.
//
// The payload names the session's main transcript and no agent: a forked
// orchestrator and its sub-agents write `<session>/subagents/agent-<id>.jsonl`.
// Agents run one at a time (delegation is synchronous; parallel batches are
// all sub-agents), so the agent asking is the one whose transcript was written
// last, and its `.meta.json` names its type.
//
// Exit 0 always; a refusal is the JSON decision on stdout.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parsePayload, readStdin } from './lib/hook-io.mjs';

const HEAVY_FLOOR = 80_000;
const NEAR_FULL = 500_000;
const MID_STEP_VALVE = 850_000;
const BOUNDARY_REQUESTS = 2;
const LEAD_AGENT_TYPES = new Set(['', 'orchestrator']);

const payload = parsePayload(readStdin()) ?? {};
const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const markerPath = join(project, '.agentic', 'step.json');

const allow = () => process.exit(0);
const refuse = (reason) => {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

const mtime = (path) => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
};

/** The transcript of the agent asking, and its type ('' for the main session). */
function askingAgent(mainPath) {
  if (typeof mainPath !== 'string') return { path: undefined, type: typeof payload.agent_type === 'string' ? payload.agent_type : '' };
  const dir = join(mainPath.replace(/\.jsonl$/, ''), 'subagents');
  const agentFile = (id) => join(dir, `agent-${id}.jsonl`);
  const typeOf = (path) => {
    if (path === mainPath) return '';
    const meta = readJson(path.replace(/\.jsonl$/, '.meta.json'));
    return typeof meta?.agentType === 'string' ? meta.agentType : 'unknown';
  };
  let path;
  if (typeof payload.agent_id === 'string' && existsSync(agentFile(payload.agent_id))) {
    path = agentFile(payload.agent_id);
  } else {
    let names = [];
    try {
      names = readdirSync(dir).filter((name) => /^agent-[\w-]+\.jsonl$/.test(name));
    } catch {
      // No sub-agent has run: the main session is asking.
    }
    path = [mainPath, ...names.map((name) => join(dir, name))].reduce((a, b) => (mtime(b) > mtime(a) ? b : a));
  }
  return { path, type: typeof payload.agent_type === 'string' ? payload.agent_type : typeOf(path) };
}

/** The last real prompt size, whether the transcript ends on an API error, and responses since `sinceMs`. */
function readTranscript(path, sinceMs) {
  const result = { prompt: 0, errored: false, requestsSince: Number.POSITIVE_INFINITY };
  if (typeof path !== 'string' || !existsSync(path)) return result;
  const ids = new Set();
  const counted = Number.isFinite(sinceMs);
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type !== 'assistant' || !record.message) continue;
    // Claude Code writes API errors (a prompt too long among them) as
    // `<synthetic>` messages with zero usage: they are no prompt size.
    result.errored = record.message.model === '<synthetic>';
    const usage = record.message.usage;
    if (result.errored || !usage) continue;
    result.prompt = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    if (counted && Date.parse(record.timestamp) > sinceMs) ids.add(record.message.id);
  }
  if (counted) result.requestsSince = ids.size;
  return result;
}

if (payload.trigger !== 'auto') allow();
if (!existsSync(markerPath)) allow();
const agent = askingAgent(payload.transcript_path);
if (!LEAD_AGENT_TYPES.has(agent.type)) allow();

const marker = readJson(markerPath) ?? {}; // An unreadable marker still means a step is in flight.
const { prompt, errored, requestsSince } = readTranscript(agent.path, Date.parse(marker.since));
const name = typeof marker.name === 'string' ? marker.name : 'a pipeline step';

if (errored || prompt >= MID_STEP_VALVE) allow();
if (requestsSince < BOUNDARY_REQUESTS) {
  if (marker.heavy === true && prompt >= HEAVY_FLOOR) allow();
  if (prompt >= NEAR_FULL) allow();
  refuse(`At the start of "${name}" with ${Math.round(prompt / 1000)}k tokens: compaction waits for a heavy step or ${NEAR_FULL / 1000}k.`);
}
refuse(`"${name}" is in flight; compaction waits for the next \`npm run pipeline -- step\` boundary.`);

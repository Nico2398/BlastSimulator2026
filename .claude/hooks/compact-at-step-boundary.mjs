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
// step ahead as heavy. Manual `/compact`, sub-agents (their payload carries
// `agent_type`) and sessions with no step marker keep Claude Code's own rule.
//
// Exit 0 always; a refusal is the JSON decision on stdout.

import { existsSync, readFileSync } from 'node:fs';
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

if (payload.trigger !== 'auto') allow();
if (!LEAD_AGENT_TYPES.has(typeof payload.agent_type === 'string' ? payload.agent_type : '')) allow();
if (!existsSync(markerPath)) allow();

let marker = {};
try {
  marker = JSON.parse(readFileSync(markerPath, 'utf8'));
} catch {
  // An unreadable marker still means a step is in flight.
}

/** The last prompt size, and how many API responses arrived since `sinceMs`. */
function readTranscript(path, sinceMs) {
  const result = { prompt: 0, requestsSince: Number.POSITIVE_INFINITY };
  if (typeof path !== 'string' || !existsSync(path)) return result;
  const ids = new Set();
  let counted = Number.isFinite(sinceMs);
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = record?.message?.usage;
    if (record?.type !== 'assistant' || !usage) continue;
    result.prompt = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    if (counted && Date.parse(record.timestamp) > sinceMs) ids.add(record.message.id);
  }
  if (counted) result.requestsSince = ids.size;
  return result;
}

const { prompt, requestsSince } = readTranscript(payload.transcript_path, Date.parse(marker.since));
const name = typeof marker.name === 'string' ? marker.name : 'a pipeline step';

if (prompt >= MID_STEP_VALVE) allow();
if (requestsSince <= BOUNDARY_REQUESTS) {
  if (marker.heavy === true && prompt >= HEAVY_FLOOR) allow();
  if (prompt >= NEAR_FULL) allow();
  refuse(`At the start of "${name}" with ${Math.round(prompt / 1000)}k tokens: compaction waits for a heavy step or ${NEAR_FULL / 1000}k.`);
}
refuse(`"${name}" is in flight; compaction waits for the next \`npm run pipeline -- step\` boundary.`);

// PreCompact hook — automatic compaction runs between pipeline steps, never
// inside one.
//
// Registered in `.claude/settings.json`. The runner sets a small auto-compact
// window, so a compaction becomes due early; this hook refuses it while
// `.agentic/step.json` says a step is in flight (`npm run pipeline -- step`).
// Claude Code asks again on every request, so the compaction runs on the first
// request after the lead marks the next boundary.
//
// Refusal is the lead's alone. Manual `/compact`, sub-agents (their payload
// carries `agent_type`), sessions with no step marker, and a lead whose last
// prompt already reached SAFETY_PROMPT_TOKENS are all allowed: a step long
// enough to approach the model's hard limit compacts where it stands rather
// than fail.
//
// Exit 0 always; a refusal is the JSON decision on stdout.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePayload, readStdin } from './lib/hook-io.mjs';

const SAFETY_PROMPT_TOKENS = 600_000;
const LEAD_AGENT_TYPES = new Set(['', 'orchestrator']);

const payload = parsePayload(readStdin()) ?? {};
const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const marker = join(project, '.agentic', 'step.json');

const allow = () => process.exit(0);

if (payload.trigger !== 'auto') allow();
if (!LEAD_AGENT_TYPES.has(typeof payload.agent_type === 'string' ? payload.agent_type : '')) allow();
if (!existsSync(marker)) allow();

/** Prompt size of the last API response the transcript recorded. */
function lastPromptTokens(path) {
  if (typeof path !== 'string' || !existsSync(path)) return 0;
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const record = JSON.parse(lines[i]);
      const usage = record?.message?.usage;
      if (record.type === 'assistant' && usage) {
        return (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      }
    } catch {
      // A line still being written.
    }
  }
  return 0;
}

if (lastPromptTokens(payload.transcript_path) >= SAFETY_PROMPT_TOKENS) allow();

let step = 'a pipeline step';
try {
  step = `step "${JSON.parse(readFileSync(marker, 'utf8')).name}"`;
} catch {
  // An unreadable marker still means a step is in flight.
}

process.stdout.write(
  JSON.stringify({ decision: 'block', reason: `${step} is in flight; compaction runs at the next \`npm run pipeline -- step\` boundary.` }),
);

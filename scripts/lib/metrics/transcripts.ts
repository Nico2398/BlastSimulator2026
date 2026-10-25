/**
 * BlastSimulator2026 — Reading Claude Code's session transcripts from disk
 *
 * Claude Code appends every session to `~/.claude/projects/<project>/<session>.jsonl`
 * as it runs, and every sub-agent to `<session>/subagents/agent-<id>.jsonl`
 * beside an `agent-<id>.meta.json` naming its type. Written incrementally, they
 * survive a step that timed out or crashed — which is exactly the run whose
 * cost is most worth knowing.
 *
 * @module metrics/transcripts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** One parsed transcript line. Only the fields the metrics read are typed. */
export interface TranscriptRecord {
  type?: string;
  subtype?: string;
  timestamp?: string;
  effort?: string;
  isSidechain?: boolean;
  message?: {
    id?: string;
    model?: string;
    content?: unknown;
    usage?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

interface SubagentTranscript {
  agentType: string;
  spawnDepth: number;
  records: TranscriptRecord[];
}

export interface SessionTranscript {
  sessionId: string;
  records: TranscriptRecord[];
  subagents: SubagentTranscript[];
}

export function parseJsonl(text: string): TranscriptRecord[] {
  const records: TranscriptRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (value !== null && typeof value === 'object') records.push(value as TranscriptRecord);
    } catch {
      // A line cut off by a killed process is the expected tail of a timed-out run.
    }
  }
  return records;
}

function readMeta(path: string): { agentType: string; spawnDepth: number } {
  try {
    const meta = JSON.parse(readFileSync(path, 'utf8')) as { agentType?: unknown; spawnDepth?: unknown };
    const agentType = typeof meta.agentType === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(meta.agentType) ? meta.agentType : 'unknown';
    return { agentType, spawnDepth: typeof meta.spawnDepth === 'number' ? meta.spawnDepth : 1 };
  } catch {
    return { agentType: 'unknown', spawnDepth: 1 };
  }
}

/** Every session under `projectsDir` whose transcript was written at or after `sinceMs`. */
export function readSessions(projectsDir: string, sinceMs = 0): SessionTranscript[] {
  if (!existsSync(projectsDir)) return [];
  const sessions: SessionTranscript[] = [];
  for (const project of readdirSync(projectsDir)) {
    const projectDir = join(projectsDir, project);
    if (!statSync(projectDir).isDirectory()) continue;
    for (const file of readdirSync(projectDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const path = join(projectDir, file);
      if (statSync(path).mtimeMs < sinceMs) continue;
      const sessionId = file.slice(0, -'.jsonl'.length);
      const subagentDir = join(projectDir, sessionId, 'subagents');
      const subagents: SubagentTranscript[] = existsSync(subagentDir)
        ? readdirSync(subagentDir)
            .filter((name) => /^agent-[A-Za-z0-9]+\.jsonl$/.test(name))
            .map((name) => ({
              ...readMeta(join(subagentDir, name.replace(/\.jsonl$/, '.meta.json'))),
              records: parseJsonl(readFileSync(join(subagentDir, name), 'utf8')),
            }))
        : [];
      sessions.push({ sessionId, records: parseJsonl(readFileSync(path, 'utf8')), subagents });
    }
  }
  return sessions;
}

// BlastSimulator2026 — Console pretty-print utilities

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

export function bold(s: string): string {
  return `${BOLD}${s}${RESET}`;
}

export function success(s: string): string {
  return `${GREEN}${s}${RESET}`;
}

export function error(s: string): string {
  return `${RED}${s}${RESET}`;
}

export function warn(s: string): string {
  return `${YELLOW}${s}${RESET}`;
}

export function info(s: string): string {
  return `${CYAN}${s}${RESET}`;
}

/** Format a key-value table from an object for terminal display. */
export function table(data: Record<string, string | number>): string {
  const entries = Object.entries(data);
  const maxKey = Math.max(...entries.map(([k]) => k.length));
  return entries.map(([k, v]) => `  ${k.padEnd(maxKey)} : ${v}`).join('\n');
}

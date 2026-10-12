/**
 * BlastSimulator2026 — Self-starting dev server
 *
 * Browser checks that need the game served (`npm run sounds:check`, `npm run audio:smoke`) start their own Vite
 * server in-process instead of asking for `npm run dev` in another terminal: no background process, nothing left
 * running if the check dies (the server is closed in a `finally`). A server already answering on the wanted port is
 * reused and left alone.
 *
 * @module shared/dev-server
 */

import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { createServer } from 'vite';

/** The repository root, which is the Vite root. */
const REPO_ROOT = resolve(import.meta.dirname ?? process.cwd(), '..', '..');
const PROBE_TIMEOUT_MS = 3000;

export interface DevServerHandle {
  /** `http://localhost:<port>` with no trailing slash. */
  readonly origin: string;
  /** True when this call started the server (and `stop` closes it); false when one was already running. */
  readonly started: boolean;
  /** Close the server this call started; does nothing for a reused one. Safe to call twice. */
  stop(): Promise<void>;
}

/** The two side effects `ensureDevServer` needs, injectable so the decision logic is testable. */
export interface DevServerDeps {
  /** True when something answers HTTP 2xx at `url`. */
  readonly probe: (url: string) => Promise<boolean>;
  /** Start a server on exactly `port` and return its closer; rejects when the port is taken. */
  readonly start: (port: number) => Promise<() => Promise<void>>;
}

export function originOf(port: number): string {
  return `http://localhost:${port}`;
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

async function startVite(port: number): Promise<() => Promise<void>> {
  const server = await createServer({ root: REPO_ROOT, server: { port, strictPort: true }, logLevel: 'error' });
  await server.listen();
  return () => server.close();
}

const DEFAULT_DEPS: DevServerDeps = { probe: probeUrl, start: startVite };

/** A TCP port the OS has just confirmed free (a race with another process is possible but unlikely). */
export function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port > 0 ? resolvePort(port) : reject(new Error('no free port'))));
    });
  });
}

/**
 * Make sure the game is served on `port`: reuse a server that already answers there, otherwise start Vite on it.
 * `probePath` is the page whose 200 proves the server is the game's (default the index page).
 */
export async function ensureDevServer(
  port: number,
  probePath = '/',
  deps: DevServerDeps = DEFAULT_DEPS,
): Promise<DevServerHandle> {
  const origin = originOf(port);
  if (await deps.probe(`${origin}${probePath}`)) {
    return { origin, started: false, stop: () => Promise.resolve() };
  }
  const close = await deps.start(port);
  let closing: Promise<void> | null = null;
  return { origin, started: true, stop: () => (closing ??= close()) };
}

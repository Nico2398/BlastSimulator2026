// BlastSimulator2026 — Self-starting dev server helper
// The decision logic with injected probe/start, and the real port finder.

import { describe, it, expect, vi, type Mock } from 'vitest';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDevServer, findFreePort, originOf, REPO_ROOT, type DevServerDeps } from '../../../../scripts/shared/dev-server.js';

function deps(up: boolean, startImpl?: DevServerDeps['start']): { deps: DevServerDeps; probe: Mock<[string], Promise<boolean>>; start: Mock<[number], Promise<() => Promise<void>>> } {
  const close = vi.fn(() => Promise.resolve());
  const probe = vi.fn((_url: string) => Promise.resolve(up));
  const start = vi.fn(startImpl ?? ((_port: number) => Promise.resolve(close)));
  return { deps: { probe, start }, probe, start };
}

describe('REPO_ROOT', () => {
  it('is the repository root whatever the working directory, found from the module location', () => {
    expect(resolve(REPO_ROOT)).toBe(resolve(import.meta.dirname, '../../../..'));
    expect(existsSync(join(REPO_ROOT, 'package.json'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'sound-lab.html'))).toBe(true);
  });
});

describe('originOf', () => {
  it('names localhost with the port and no trailing slash', () => {
    expect(originOf(5173)).toBe('http://localhost:5173');
  });
});

describe('ensureDevServer', () => {
  it('reuses a server that already answers and never starts or stops one', async () => {
    const d = deps(true);
    const handle = await ensureDevServer(5173, '/sound-lab.html', d.deps);
    expect(d.probe).toHaveBeenCalledWith('http://localhost:5173/sound-lab.html');
    expect(d.start).not.toHaveBeenCalled();
    expect(handle).toMatchObject({ origin: 'http://localhost:5173', started: false });
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('starts a server on the wanted port when nothing answers, and closes it once however often stop is called', async () => {
    const close = vi.fn(() => Promise.resolve());
    const d = deps(false, () => Promise.resolve(close));
    const handle = await ensureDevServer(6001, '/', d.deps);
    expect(d.start).toHaveBeenCalledWith(6001);
    expect(handle).toMatchObject({ origin: 'http://localhost:6001', started: true });
    await handle.stop();
    await handle.stop();
    expect(close).toHaveBeenCalledOnce();
  });

  it('lets a failed start (port taken by something that is not the game) reach the caller', async () => {
    const d = deps(false, () => Promise.reject(new Error('Port 5173 is already in use')));
    await expect(ensureDevServer(5173, '/', d.deps)).rejects.toThrow('already in use');
  });
});

describe('findFreePort', () => {
  it('returns a port nothing is listening on, and not the same one while it is held', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    const holder = createServer();
    await new Promise<void>(resolve => holder.listen(port, resolve));
    try {
      expect(await findFreePort()).not.toBe(port);
    } finally {
      await new Promise<void>(resolve => holder.close(() => resolve()));
    }
  });
});

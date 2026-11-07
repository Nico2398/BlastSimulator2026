// BlastSimulator2026 — Who may put work in front of the autonomous pipeline.
//
// `.github/scripts/pipeline-trust.cjs` is read by the merge gate, the CI
// fail-safe, the assigner and intake. The repository is public, and the
// 2026-11-06 audit (outside PRs #2150/#2151) found each of those acting on a
// stranger's pull request or issue — see the module's own header.
//
// Loaded the way `assignability.test.ts` loads `assignability.cjs`: this
// drives the source that actually ships, not a copy of it.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
const { issueTrust, pullRequestTrust } = require(join(ROOT, '.github/scripts/pipeline-trust.cjs'));

const REPOSITORY = 'Nico2398/BlastSimulator2026';
const OWNER = { login: 'Nico2398', type: 'User' };
const STRANGER = { login: 'battle-mage', type: 'User' };

const pr = (overrides: { headRepo?: string | null; user?: { login: string; type: string } | null } = {}) => ({
  head: {
    ref: 'pipeline/feature-1-2',
    repo: overrides.headRepo === null ? null : { full_name: overrides.headRepo ?? REPOSITORY },
  },
  user: overrides.user === undefined ? OWNER : overrides.user,
});

const permissionOf = (permissions: Record<string, string>) => {
  const asked: string[] = [];
  const read = async (login: string) => {
    asked.push(login);
    if (!(login in permissions)) throw Object.assign(new Error('Not Found'), { status: 404 });
    return permissions[login]!;
  };
  return { read, asked };
};

describe('a pull request the pipeline may act on', () => {
  it('is the owner\'s, from a branch of this repository', async () => {
    const { read } = permissionOf({ Nico2398: 'admin' });
    const verdict = await pullRequestTrust({ pr: pr(), repository: REPOSITORY, readPermission: read });
    expect(verdict).toMatchObject({ trusted: true, unreadable: false });
  });

  it('is an installed app\'s without asking its permission', async () => {
    const { read, asked } = permissionOf({});
    const verdict = await pullRequestTrust({
      pr: pr({ user: { login: 'github-actions[bot]', type: 'Bot' } }),
      repository: REPOSITORY,
      readPermission: read,
    });
    expect(verdict.trusted).toBe(true);
    expect(asked).toEqual([]);
  });

  it('reads the repository name case-insensitively, as GitHub does', async () => {
    const { read } = permissionOf({ Nico2398: 'admin' });
    const verdict = await pullRequestTrust({ pr: pr({ headRepo: 'nico2398/blastsimulator2026' }), repository: REPOSITORY, readPermission: read });
    expect(verdict.trusted).toBe(true);
  });

  // A fork's owner can push to its branch after anyone trusted has looked at
  // it — even when the owner of this repository opened the pull request.
  it.each([
    ['a stranger\'s fork', STRANGER],
    ['a fork the owner opened it from', OWNER],
    ['a fork an app opened it from', { login: 'github-actions[bot]', type: 'Bot' }],
  ])('is never one from %s', async (_, user) => {
    const { read, asked } = permissionOf({ Nico2398: 'admin', 'battle-mage': 'read' });
    const verdict = await pullRequestTrust({
      pr: pr({ headRepo: 'battle-mage/BlastSimulator2026', user }),
      repository: REPOSITORY,
      readPermission: read,
    });
    expect(verdict).toMatchObject({ trusted: false, unreadable: false });
    expect(verdict.reason).toContain('battle-mage/BlastSimulator2026');
    expect(asked).toEqual([]);
  });

  it('is never one whose head repository is gone', async () => {
    const { read } = permissionOf({ Nico2398: 'admin' });
    const verdict = await pullRequestTrust({ pr: pr({ headRepo: null }), repository: REPOSITORY, readPermission: read });
    expect(verdict).toMatchObject({ trusted: false, unreadable: false });
  });

  // Anyone can open a pull request between two branches of a public repository.
  it.each(['write', 'read', 'none'])('is never one a %s account opened from this repository\'s branch', async (permission) => {
    const { read } = permissionOf({ 'battle-mage': permission });
    const verdict = await pullRequestTrust({ pr: pr({ user: STRANGER }), repository: REPOSITORY, readPermission: read });
    expect(verdict).toMatchObject({ trusted: false, unreadable: false });
    expect(verdict.reason).toContain(permission);
  });

  it('is never one with no author', async () => {
    const { read } = permissionOf({});
    const verdict = await pullRequestTrust({ pr: pr({ user: null }), repository: REPOSITORY, readPermission: read });
    expect(verdict).toMatchObject({ trusted: false, unreadable: false });
  });

  // Fail closed: a permission that was not read is not `admin`.
  it('is unreadable, and untrusted, when the author\'s permission cannot be read', async () => {
    const verdict = await pullRequestTrust({
      pr: pr(),
      repository: REPOSITORY,
      readPermission: async () => {
        throw Object.assign(new Error('Server Error'), { status: 500 });
      },
    });
    expect(verdict).toMatchObject({ trusted: false, unreadable: true });
    expect(verdict.reason).toContain('500');
  });
});

describe('an issue the pipeline may assign', () => {
  it('is one the owner filed', () => {
    expect(issueTrust({ user: OWNER, author_association: 'OWNER' }).trusted).toBe(true);
  });

  it('is one an installed app filed', () => {
    expect(issueTrust({ user: { login: 'claude[bot]', type: 'Bot' }, author_association: 'NONE' }).trusted).toBe(true);
  });

  it.each(['NONE', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'CONTRIBUTOR', 'COLLABORATOR', 'MEMBER', 'MANNEQUIN'])(
    'is never one a %s account filed',
    (association) => {
      const verdict = issueTrust({ user: STRANGER, author_association: association });
      expect(verdict.trusted).toBe(false);
      expect(verdict.reason).toContain('battle-mage');
    }
  );

  it('is never one whose author was not read', () => {
    expect(issueTrust({}).trusted).toBe(false);
    expect(issueTrust({ user: null, author_association: null }).trusted).toBe(false);
  });
});

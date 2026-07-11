/**
 * DB-free unit tests for the POST /v1/profile/import handler. Exercises the pure
 * handler against InMemoryProfileRepo + a fake ExtractionPort — no Nest, no
 * Postgres. Locks the three things the e2e can't cheaply prove per-branch:
 *  - per-user scoping (userId comes only from the verified context),
 *  - the two import paths (resumeText → extractor, entities → passthrough),
 *  - validation fail-closed (neither/both fields → 422).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ParsedEntity } from '@careeros/contracts';
import {
  contextFromVerifiedClaims,
  importProfile,
  InMemoryProfileRepo,
  type ExtractionPort,
  type ProfileImportDeps,
  type RequestContext,
} from '../src/index.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-1' });

/** Fake extractor: returns a fixed grounded entity for any text. */
class FakeExtractor implements ExtractionPort {
  constructor(private readonly entities: ParsedEntity[]) {}
  extract(): Promise<ParsedEntity[]> {
    return Promise.resolve(this.entities);
  }
}

const expEntity: ParsedEntity = {
  kind: 'experience',
  name: 'Acme Corp',
  detail: 'Senior Engineer',
  company: 'Acme Corp',
  title: 'Senior Engineer',
  provenance: { source: 'resume', quote: 'Senior Engineer at Acme Corp' },
};

describe('POST /v1/profile/import handler', () => {
  let profiles: InMemoryProfileRepo;
  let deps: ProfileImportDeps;

  beforeEach(() => {
    profiles = new InMemoryProfileRepo();
    deps = { extractor: new FakeExtractor([expEntity]), profiles };
  });

  it('resumeText path runs the extractor and persists under the caller', async () => {
    const res = await importProfile(ctx(USER_A), { resumeText: 'a resume' }, deps);
    expect(res.status).toBe(200);
    const body = res.body as { profileId: string; counts: { experiences: number }; entities: unknown[] };
    expect(body.counts.experiences).toBe(1);
    expect(body.entities).toHaveLength(1);
    expect(profiles.dump(USER_A)).toHaveLength(1);
  });

  it('entities path persists the already-parsed payload (skips the extractor)', async () => {
    const skill: ParsedEntity = {
      kind: 'skill',
      name: 'TypeScript',
      detail: 'demonstrated',
      evidence: 'demonstrated',
      provenance: { source: 'resume', quote: 'Built services in TypeScript' },
    };
    const res = await importProfile(ctx(USER_A), { entities: [skill] }, deps);
    expect(res.status).toBe(200);
    const body = res.body as { counts: { skillClaims: number } };
    expect(body.counts.skillClaims).toBe(1);
  });

  it('scopes writes to the verified user — B can never land in A (body has no userId to spoof)', async () => {
    await importProfile(ctx(USER_A), { resumeText: 'a' }, deps);
    await importProfile(ctx(USER_B), { resumeText: 'b' }, deps);
    expect(profiles.dump(USER_A)).toHaveLength(1);
    expect(profiles.dump(USER_B)).toHaveLength(1);
    // Distinct profiles.
    const a = await importProfile(ctx(USER_A), { resumeText: 'a2' }, deps);
    const b = await importProfile(ctx(USER_B), { resumeText: 'b2' }, deps);
    expect((a.body as { profileId: string }).profileId).not.toBe((b.body as { profileId: string }).profileId);
  });

  it('rejects a payload with NEITHER resumeText nor entities → 422', async () => {
    const res = await importProfile(ctx(USER_A), {}, deps);
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe('validation_failed');
  });

  it('rejects a payload with BOTH resumeText and entities → 422', async () => {
    const res = await importProfile(
      ctx(USER_A),
      { resumeText: 'x', entities: [expEntity] },
      deps,
    );
    expect(res.status).toBe(422);
  });

  it('re-import appends under the SAME profile (one profile per user)', async () => {
    const first = await importProfile(ctx(USER_A), { resumeText: 'a' }, deps);
    const second = await importProfile(ctx(USER_A), { resumeText: 'a-again' }, deps);
    expect((first.body as { profileId: string }).profileId).toBe(
      (second.body as { profileId: string }).profileId,
    );
    expect(profiles.dump(USER_A)).toHaveLength(2);
  });
});

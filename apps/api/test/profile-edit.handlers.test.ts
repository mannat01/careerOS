import { beforeEach, describe, expect, it } from 'vitest';
import type { ParsedEntity } from '@careeros/contracts';
import {
  contextFromVerifiedClaims,
  editProfileFact,
  InMemoryProfileRepo,
  type ProfileFactEditMemoryPort,
  type RequestContext,
} from '../src/index.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ctx = (userId: string): RequestContext =>
  contextFromVerifiedClaims({ userId, traceId: 'trace-edit' });

const importedSkill: ParsedEntity = {
  kind: 'skill',
  name: 'Postgress',
  evidence: 'claimed',
  provenance: { source: 'resume', quote: 'Skills: Postgress' },
};

class RecordingEditMemory implements ProfileFactEditMemoryPort {
  readonly events: Array<Parameters<ProfileFactEditMemoryPort['recordProfileFactEdit']>[0]> = [];

  recordProfileFactEdit(
    input: Parameters<ProfileFactEditMemoryPort['recordProfileFactEdit']>[0],
  ): Promise<void> {
    this.events.push(input);
    return Promise.resolve();
  }
}

describe('PATCH /v1/profile/facts/:id handler', () => {
  let profiles: InMemoryProfileRepo;
  let memory: RecordingEditMemory;
  let factA: string;
  let factB: string;

  beforeEach(async () => {
    profiles = new InMemoryProfileRepo();
    memory = new RecordingEditMemory();
    factA = (await profiles.importEntities(USER_A, [importedSkill])).entities[0]!.id;
    factB = (await profiles.importEntities(USER_B, [importedSkill])).entities[0]!.id;
  });

  it('persists an authoritative correction and emits one scoped edit event', async () => {
    const result = await editProfileFact(
      ctx(USER_A),
      factA,
      { kind: 'skill', label: 'PostgreSQL' },
      { profiles, memory },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      fact: {
        id: factA,
        kind: 'skill',
        label: 'PostgreSQL',
        detail: null,
        provenance: 'user',
      },
    });
    expect(memory.events).toEqual([
      expect.objectContaining({
        userId: USER_A,
        factId: factA,
        kind: 'skill',
        beforeLabel: 'Postgress',
        afterLabel: 'PostgreSQL',
      }),
    ]);
  });

  it("returns 404 when A targets B's fact and emits no event", async () => {
    const result = await editProfileFact(
      ctx(USER_A),
      factB,
      { kind: 'skill', label: 'Stolen edit' },
      { profiles, memory },
    );

    expect(result.status).toBe(404);
    expect(memory.events).toHaveLength(0);
    expect(profiles.dump(USER_B)[0]?.name).toBe('Postgress');
  });

  it('fails closed on invalid kind or blank label before persistence', async () => {
    const result = await editProfileFact(
      ctx(USER_A),
      factA,
      { kind: 'unknown', label: '   ' },
      { profiles, memory },
    );

    expect(result.status).toBe(422);
    expect(profiles.dump(USER_A)[0]?.name).toBe('Postgress');
    expect(memory.events).toHaveLength(0);
  });
});
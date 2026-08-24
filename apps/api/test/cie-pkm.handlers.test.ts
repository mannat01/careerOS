import { describe, expect, it } from 'vitest';
import { InMemoryPkmMemory, InMemoryPkmStore, PkmService } from '@careeros/cie-pkm';
import { contextFromVerifiedClaims } from '../src/index.js';
import {
  createPkmEntry,
  deletePkmEntry,
  getPkmEntry,
  listPkmEntries,
  updatePkmEntry,
  type PkmHandlerDeps,
} from '../src/modules/cie/pkm.handlers.js';

const USER_A = '00000000-0000-4000-8000-000000000121';
const USER_B = '00000000-0000-4000-8000-000000000122';

function ctx(userId: string) {
  return contextFromVerifiedClaims({ userId, traceId: `trace-${userId}`, headers: {} });
}

function deps(): PkmHandlerDeps {
  return { pkm: new PkmService({ store: new InMemoryPkmStore(), memory: new InMemoryPkmMemory() }) };
}

describe('/v1/pkm handlers', () => {
  it('performs caller-scoped CRUD with the contract list envelope', async () => {
    const d = deps();
    const created = await createPkmEntry(ctx(USER_A), { title: 'Note', body: 'Body', tags: ['Career'] }, d);
    expect(created.status).toBe(201);
    if (!('id' in created.body)) throw new Error('Expected PKM entry.');

    expect((await listPkmEntries(ctx(USER_A), {}, d)).body).toMatchObject({ data: [{ id: created.body.id }] });
    expect((await getPkmEntry(ctx(USER_A), created.body.id, d)).status).toBe(200);
    const updated = await updatePkmEntry(ctx(USER_A), created.body.id, { title: 'Updated' }, d);
    expect(updated.body).toMatchObject({ title: 'Updated', provenance: 'user' });
    expect((await deletePkmEntry(ctx(USER_A), created.body.id, d)).status).toBe(200);
    expect((await getPkmEntry(ctx(USER_A), created.body.id, d)).status).toBe(404);
  });

  it('conceals another owner entry for GET/PATCH/DELETE', async () => {
    const d = deps();
    const created = await createPkmEntry(ctx(USER_A), { title: 'Private', body: 'Owner only' }, d);
    if (!('id' in created.body)) throw new Error('Expected PKM entry.');
    expect((await getPkmEntry(ctx(USER_B), created.body.id, d)).status).toBe(404);
    expect((await updatePkmEntry(ctx(USER_B), created.body.id, { title: 'No' }, d)).status).toBe(404);
    expect((await deletePkmEntry(ctx(USER_B), created.body.id, d)).status).toBe(404);
    expect((await getPkmEntry(ctx(USER_A), created.body.id, d)).status).toBe(200);
  });

  it.each([
    [{ title: 'Note', body: 'Body', userId: USER_B }],
    [{ title: 'Note', body: 'Body', provenance: 'imported' }],
    [{ title: '', body: '' }],
  ])('rejects invalid create input', async (input) => {
    expect((await createPkmEntry(ctx(USER_A), input, deps())).status).toBe(422);
  });

  it('rejects empty/controlled update fields and malformed ids', async () => {
    const d = deps();
    expect((await updatePkmEntry(ctx(USER_A), USER_A, {}, d)).status).toBe(422);
    expect((await updatePkmEntry(ctx(USER_A), USER_A, { provenance: 'user' }, d)).status).toBe(422);
    expect((await getPkmEntry(ctx(USER_A), 'not-a-uuid', d)).status).toBe(422);
  });
});
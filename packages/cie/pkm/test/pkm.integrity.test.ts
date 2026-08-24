import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryPkmMemory, InMemoryPkmStore, PkmService } from '../src/index.js';

const USER_A = '00000000-0000-4000-8000-000000000101';
const USER_B = '00000000-0000-4000-8000-000000000102';

describe('PkmService', () => {
  let store: InMemoryPkmStore;
  let memory: InMemoryPkmMemory;
  let service: PkmService;

  beforeEach(() => {
    store = new InMemoryPkmStore();
    memory = new InMemoryPkmMemory();
    service = new PkmService({ store, memory });
  });

  it('sets caller identity and user provenance while normalizing tags', async () => {
    const entry = await service.create(USER_A, {
      title: '  Architecture notes  ',
      body: '  Prefer reversible migrations.  ',
      tags: ['Platform', 'platform', 'Postgres!'],
    });
    expect(entry).toMatchObject({
      userId: USER_A,
      title: 'Architecture notes',
      body: 'Prefer reversible migrations.',
      tags: ['platform', 'postgres'],
      provenance: 'user',
    });
    expect(memory.events).toEqual([{ userId: USER_A, entryId: entry.id, action: 'created' }]);
  });

  it('lists and reads only the caller entries', async () => {
    const owned = await service.create(USER_A, { title: 'A', body: 'A body' });
    await service.create(USER_B, { title: 'B', body: 'B body' });
    expect((await service.list(USER_A)).map((entry) => entry.id)).toEqual([owned.id]);
    expect(await service.get(USER_B, owned.id)).toBeNull();
  });

  it('updates editable fields, keeps provenance user, and audits', async () => {
    const entry = await service.create(USER_A, { title: 'Before', body: 'Body' });
    const updated = await service.update(USER_A, entry.id, { title: 'After', tags: ['Career'] });
    expect(updated).toMatchObject({ title: 'After', body: 'Body', tags: ['career'], provenance: 'user' });
    expect(memory.events.at(-1)).toEqual({ userId: USER_A, entryId: entry.id, action: 'updated' });
  });

  it('wrong-owner update/delete are no-ops and emit no audit', async () => {
    const entry = await service.create(USER_A, { title: 'Private', body: 'Owner only' });
    const count = memory.events.length;
    expect(await service.update(USER_B, entry.id, { title: 'Stolen' })).toBeNull();
    expect(await service.delete(USER_B, entry.id)).toBe(false);
    expect(memory.events).toHaveLength(count);
    expect((await service.get(USER_A, entry.id))?.title).toBe('Private');
  });

  it('owner delete removes the entry and appends an audit event', async () => {
    const entry = await service.create(USER_A, { title: 'Delete me', body: 'Temporary' });
    expect(await service.delete(USER_A, entry.id)).toBe(true);
    expect(await service.get(USER_A, entry.id)).toBeNull();
    expect(memory.events.at(-1)).toEqual({ userId: USER_A, entryId: entry.id, action: 'deleted' });
  });
});
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SOURCE_REGISTRY_SEED } from '../src/index.js';

const schema = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../prisma/schema.prisma'),
  'utf8',
);

describe('M01 Prisma schema (authored, database-schema.md)', () => {
  it('declares every M01 entity', () => {
    for (const model of [
      'User', 'UserSettings', 'Profile', 'Experience', 'Project', 'Education',
      'SkillClaim', 'Opportunity', 'SourceRegistry', 'AuditLog', 'ApprovalToken',
    ]) {
      expect(schema).toMatch(new RegExp(`model ${model} \\{`));
    }
  });

  it('uses pgvector embedding columns where specified', () => {
    expect(schema).toContain('extensions = [pgvector(map: "vector")]');
    expect((schema.match(/Unsupported\("vector\(1536\)"\)\?/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('scopes user-owned tables and keeps dedup/uniqueness invariants', () => {
    expect(schema).toMatch(/@@unique\(\[sourceKey, sourceRef\]\)/);
    expect(schema).toMatch(/@@index\(\[dedupKey\]\)/);
    expect(schema).toMatch(/@@index\(\[userId, at\]\)/);
    expect(schema).toContain('onDelete: Cascade'); // hard-delete cascade
  });

  it('provenance is mandatory on profile facts', () => {
    expect(schema).toMatch(/enum Provenance/);
    expect((schema.match(/provenance\s+Provenance\b/g) ?? []).length).toBe(4);
  });
});

describe('SourceRegistry seed (ADR-002)', () => {
  it('M04 launch set: exactly three enabled sources — greenhouse + lever + usajobs', () => {
    const enabled = SOURCE_REGISTRY_SEED.filter((s) => s.enabled);
    const byKey = new Map(enabled.map((s) => [s.key, s]));
    expect([...byKey.keys()].sort()).toEqual(['greenhouse', 'lever', 'usajobs']);
    expect(byKey.get('greenhouse')?.hosts).toEqual(['boards-api.greenhouse.io']);
    expect(byKey.get('lever')?.hosts).toEqual(['api.lever.co']);
    expect(byKey.get('usajobs')?.hosts).toEqual(['data.usajobs.gov']);
    // ADR-002: every enabled source ships with a rate policy (M04 §Deliverables).
    for (const s of enabled) expect(s.ratePolicy).toBeTruthy();
  });
});


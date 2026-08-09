import { describe, expect, it } from 'vitest';
import { DEV_USER_EMAIL, DEV_USER_ID } from '@careeros/contracts';
import { devPrincipalForEmail } from './dev-principal';

describe('dev principal mapping', () => {
  it('keeps the canonical seeded user deterministic and complete-compatible', () => {
    expect(devPrincipalForEmail(DEV_USER_EMAIL)).toBe(DEV_USER_ID);
    expect(devPrincipalForEmail(`  ${DEV_USER_EMAIL.toUpperCase()} `)).toBe(DEV_USER_ID);
  });

  it('maps each normalized non-seed email to a stable isolated UUID', () => {
    const first = devPrincipalForEmail('first-run@example.test');
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(devPrincipalForEmail('FIRST-RUN@example.test')).toBe(first);
    expect(devPrincipalForEmail('second@example.test')).not.toBe(first);
  });
});
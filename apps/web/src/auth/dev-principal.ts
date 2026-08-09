import { createHash } from 'node:crypto';
import { DEV_USER_EMAIL, DEV_USER_ID } from '@careeros/contracts';

/** Stable dev provider subject. The canonical seed stays fixed; other emails are isolated principals. */
export function devPrincipalForEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized === DEV_USER_EMAIL) return DEV_USER_ID;
  const bytes = createHash('sha256').update(`careeros-dev|${normalized}`, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
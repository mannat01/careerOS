/**
 * Ports the PkmService depends on. Concrete implementations live in
 * @careeros/db (Prisma-backed) — this package NEVER imports @careeros/db.
 */
import type { PkmEntry } from './model.js';

export interface PkmCreateInput {
  userId: string;
  title: string;
  body: string;
  tags: string[];
  provenance: 'user';
}

export interface PkmUpdateInput {
  title?: string;
  body?: string;
  tags?: string[];
}

/**
 * Narrow store port for PKM entries. Every method is PER-USER scoped by
 * userId; a cross-user id read returns null (handler → 404) so cross-user
 * leakage is impossible by construction.
 */
export interface PkmStorePort {
  create(input: PkmCreateInput): Promise<PkmEntry>;
  list(userId: string): Promise<PkmEntry[]>;
  get(userId: string, id: string): Promise<PkmEntry | null>;
  update(userId: string, id: string, input: PkmUpdateInput): Promise<PkmEntry | null>;
  delete(userId: string, id: string): Promise<PkmEntry | null>;
}

/** Append-only episodic audit seam. */
export interface PkmMemoryPort {
  recordMutation(input: {
    userId: string;
    entryId: string;
    action: 'created' | 'updated' | 'deleted';
  }): Promise<void>;
}
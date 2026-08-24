/**
 * @careeros/cie-pkm — Personal Knowledge Management domain types.
 *
 * PKM is the user's private capture surface. Entries are per-user scoped and
 * always carry server-owned `user` provenance, so they cannot be confused with
 * imported or inferred facts.
 *
 * The package is DB-free by construction: the service depends on a narrow
 * PkmStorePort (owned here), which the Prisma adapter in @careeros/db implements.
 */

/** One private, user-authored PKM entry. */
export interface PkmEntry {
  id: string;
  userId: string;
  title: string;
  body: string;
  tags: string[];
  provenance: 'user';
  createdAt: string;
  updatedAt: string;
}

export interface PkmEntryInput {
  userId: string;
  title: string;
  body: string;
  tags?: string[];
}
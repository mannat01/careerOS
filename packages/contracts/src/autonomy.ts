import { z } from 'zod';

/**
 * Autonomy tiers — architecture.md §5 / CLAUDE.md §3.
 * Green = auto/advisory · Yellow = approve-then-act · Red = never automated.
 * The capability-gate registry is authoritative; user `autonomyDefaults` may make an
 * action MORE restrictive, never less (the gate enforces the floor, not settings).
 */
export const autonomyTierSchema = z.enum(['green', 'yellow', 'red']);
export type AutonomyTier = z.infer<typeof autonomyTierSchema>;

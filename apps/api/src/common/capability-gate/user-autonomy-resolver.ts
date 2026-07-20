/**
 * M07 Step 5 — factory for the interceptor's per-user autonomy-tier lookup.
 *
 * The interceptor (`withCapabilityGate`) accepts a `UserAutonomyResolver` that
 * maps (userId, action) → optional user override. In production the resolver
 * reads `UserSettings.autonomyDefaults` via `UserSettingsRepo`; the gate's
 * `effectiveTier` rule then combines the override with the registry tier under
 * a tightening-only invariant (users may raise Green→Yellow or Yellow→Red for
 * themselves; NEVER loosen the registry floor).
 *
 * A missing UserSettings row is a first-login user — no override; we return
 * `undefined` (registry wins). Missing/malformed values in the map are treated
 * the same way — never a silent loosening.
 */
import type { AutonomyTier } from '@careeros/contracts';
import type { UserSettingsRepo } from '../../modules/identity/repos.js';
import type { UserAutonomyResolver } from './gate-interceptor.js';

const VALID_TIERS: ReadonlySet<AutonomyTier> = new Set(['green', 'yellow', 'red']);

export function makeUserAutonomyResolver(settings: UserSettingsRepo): UserAutonomyResolver {
  return async (userId, action) => {
    const row = await settings.findByUserId(userId);
    if (!row) return undefined;
    const override = row.autonomyDefaults[action];
    if (typeof override !== 'string') return undefined;
    return VALID_TIERS.has(override) ? override : undefined;
  };
}
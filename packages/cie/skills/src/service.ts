/**
 * GapAnalyzerService — reaches match signals / state model / target roles ONLY
 * via narrow ports (never @careeros/db). Computes the gap set + learning
 * recommendations deterministically (analyzer.ts) and self-verifies with the
 * integrity guardrail before returning — a violation here would be a bug, so
 * anything flagged is discarded (discard-and-recompute discipline).
 */
import { analyzeGaps, verifyGapAnalysis } from './analyzer.js';
import type { GapAnalysis, GapAnalyzerInput, GapMatchSignal, GapStateDimension } from './model.js';

/** Reads the user's real (profile, opportunity) match signals. */
export interface GapMatchPort {
  readMatchSignals(userId: string): Promise<GapMatchSignal[]>;
}

/** Reads the user's derived Career State Model dimensions. */
export interface GapStatePort {
  readStateDimensions(userId: string): Promise<GapStateDimension[]>;
}

/** Reads the user's STATED target roles (profiles.target_roles). */
export interface GapTargetRolePort {
  readTargetRoles(userId: string): Promise<string[]>;
}

export interface GapAnalyzerServiceDeps {
  matches: GapMatchPort;
  state: GapStatePort;
  targets: GapTargetRolePort;
}

export class GapAnalyzerService {
  constructor(private readonly deps: GapAnalyzerServiceDeps) {}

  /** Gather inputs via ports; compute + integrity-check the gap set. */
  async analyze(userId: string): Promise<GapAnalysis> {
    const [matches, stateModel, targetRoles] = await Promise.all([
      this.deps.matches.readMatchSignals(userId),
      this.deps.state.readStateDimensions(userId),
      this.deps.targets.readTargetRoles(userId),
    ]);
    const input: GapAnalyzerInput = { matches, stateModel, targetRoles };
    const analysis = analyzeGaps(input);

    // Self-check: the deterministic pipeline must be integrity-clean by
    // construction. Discard anything a (future) drafting path smuggled in.
    const violations = verifyGapAnalysis(analysis, input);
    if (violations.length === 0) return analysis;
    const bad = new Set(violations.map((v) => v.subject));
    return {
      modelVersion: analysis.modelVersion,
      gaps: analysis.gaps.filter((g) => !bad.has(g.key)),
      learningItems: analysis.learningItems.filter((i) => !bad.has(i.gapKey)),
    };
  }
}
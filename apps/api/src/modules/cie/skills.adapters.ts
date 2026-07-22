/**
 * M09 Step 3 — GapAnalyzer port adapters + planner/dashboard wiring.
 *
 * The GapAnalyzerService (packages/cie/skills) reaches match signals / state
 * model / target roles ONLY through narrow ports; it never imports
 * @careeros/db. This file wires those ports to the live services present in
 * the composition root, same discipline as dashboard.adapters.ts.
 *
 * Also here (light wiring, no rebuilds):
 *   - `PersistedSkillGapPlannerGapReader` — feeds the persisted SkillGap rows
 *     into the EXISTING planner gap intake (`PlannerGraphPort.readGaps`),
 *     mapping each gap onto a real graph node so the planner's grounding
 *     guardrail keeps holding.
 */
import type { CareerStateService, CareerStateDimension } from '@careeros/cie-state';
import type { GraphMemoryService } from '@careeros/memory';
import type {
  GapMatchPort,
  GapStatePort,
  GapTargetRolePort,
  GapMatchSignal,
  GapStateDimension,
} from '@careeros/cie-skills';
import type { SkillGap as PlannerSkillGap } from '@careeros/cie-planner';
import type { GapSignalReadPortShape, SkillGapStorePortShape } from '@careeros/db';
import type { ProfileResolverPort } from '@careeros/db';

// ---------------- GapMatchPort ← GapSignalReadStore ----------------

export class GapSignalMatchAdapter implements GapMatchPort {
  constructor(
    private readonly signals: GapSignalReadPortShape,
    private readonly profiles: ProfileResolverPort,
  ) {}

  async readMatchSignals(userId: string): Promise<GapMatchSignal[]> {
    const profileId = await this.profiles.resolveProfileId(userId);
    if (!profileId) return [];
    return this.signals.readMatchSignals(profileId);
  }
}

// ---------------- GapStatePort ← CareerStateService ----------------

export class StateServiceGapStateAdapter implements GapStatePort {
  constructor(private readonly state: CareerStateService) {}

  async readStateDimensions(userId: string): Promise<GapStateDimension[]> {
    const existing = await this.state.getState(userId);
    const model = existing ?? (await this.state.recompute(userId, userId));
    return model.dimensions.map(
      (d: CareerStateDimension): GapStateDimension => ({
        dimension: d.dimension,
        values: d.value.values,
        confidence: d.confidence,
      }),
    );
  }
}

// ---------------- GapTargetRolePort ← GapSignalReadStore ----------------

export class GapSignalTargetRoleAdapter implements GapTargetRolePort {
  constructor(
    private readonly signals: GapSignalReadPortShape,
    private readonly profiles: ProfileResolverPort,
  ) {}

  async readTargetRoles(userId: string): Promise<string[]> {
    const profileId = await this.profiles.resolveProfileId(userId);
    if (!profileId) return [];
    return this.signals.readTargetRoles(profileId);
  }
}

// ---------------- planner gap intake ← persisted SkillGap rows ----------------

/** Narrow shape plan.adapters' GraphMemoryPlannerAdapter accepts for gaps. */
export interface PlannerGapReaderPort {
  readGaps(userId: string): Promise<PlannerSkillGap[]>;
}

/**
 * Feeds the PERSISTED skill_gaps rows into the existing planner gap intake.
 * Each planner gap must point at a real graph node (the planner grounds or
 * falls back); we match by skill-vs-label (case-insensitive), else the first
 * skill node, else the gap is skipped (never an invented node id).
 */
export class PersistedSkillGapPlannerGapReader implements PlannerGapReaderPort {
  constructor(
    private readonly store: SkillGapStorePortShape,
    private readonly profiles: ProfileResolverPort,
    private readonly graph: GraphMemoryService,
  ) {}

  async readGaps(userId: string): Promise<PlannerSkillGap[]> {
    const profileId = await this.profiles.resolveProfileId(userId);
    if (!profileId) return [];
    const [rows, nodes] = await Promise.all([
      this.store.listGaps(profileId),
      this.graph.listNodes(userId),
    ]);
    const skillNodes = nodes.filter((n) => n.kind === 'skill');
    const fallback = skillNodes[0];
    const gaps: PlannerSkillGap[] = [];
    for (const row of rows) {
      const node =
        skillNodes.find((n) => n.label.trim().toLowerCase() === row.skill) ?? fallback;
      if (!node) continue; // no real node to ground on — never invent one.
      gaps.push({
        id: row.id,
        skill: row.skill,
        nodeId: node.id,
        description: row.gap,
      });
    }
    return gaps;
  }
}
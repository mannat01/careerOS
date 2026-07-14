/**
 * ResumeService — the application service that owns the ResumeModel/ResumeVariant
 * lifecycle: derive the base model from the profile → tailor a job-bound variant
 * → persist → retrieve.
 *
 * It depends on NARROW PORTS, never on @careeros/db or MemoryService directly, so
 * it stays a pure, unit-testable orchestrator:
 *   - `ResumeFactPort`  — reads a user's structured profile facts (backed in the
 *     app by MemoryService's ProfileReader).
 *   - `ResumeModelStore` — persists/reads ResumeModel rows (Prisma in prod,
 *     in-memory in tests).
 *   - `ResumeVariantStore` — persists/reads ResumeVariant rows.
 *   - `TailoringAgent` — the Tailor (LLM + deterministic grounding guardrail).
 *   - `ResumeIdGen` — id minting (deterministic in tests).
 *
 * PER-USER by construction: the userId flows from the verified request context;
 * the base model's `profileId` is the user, and a variant is only ever read back
 * for its owner.
 */
import type { TailoringAgent, TailorVariantResult } from './agent.js';
import { toVariant } from './agent.js';
import {
  type JobDescription,
  type ResumeModel,
  type ResumeVariant,
  type SelectedItem,
  type TailorProfileFact,
} from './model.js';

// ---------- ports ----------

/** Reads a user's structured profile facts (app-side adapter wraps MemoryService). */
export interface ResumeFactPort {
  readResumeFacts(userId: string): Promise<TailorProfileFact[]>;
}

/** Persistence port for the ResumeModel (Prisma in prod, in-memory in tests). */
export interface ResumeModelStore {
  loadBase(profileId: string): Promise<ResumeModel | null>;
  save(model: ResumeModel): Promise<ResumeModel>;
}

/** Persistence port for the ResumeVariant. Reads are scoped by owning user. */
export interface ResumeVariantStore {
  save(userId: string, variant: ResumeVariant): Promise<ResumeVariant>;
  load(userId: string, variantId: string): Promise<ResumeVariant | null>;
}

/** Id minting seam (deterministic in tests). */
export interface ResumeIdGen {
  next(prefix: string): string;
}

export interface ResumeServiceDeps {
  facts: ResumeFactPort;
  models: ResumeModelStore;
  variants: ResumeVariantStore;
  agent: TailoringAgent & { tailorVariant(profile: TailorProfileFact[], job: JobDescription): Promise<TailorVariantResult> };
  ids: ResumeIdGen;
}

// ---------- service ----------

export class ResumeService {
  constructor(private readonly deps: ResumeServiceDeps) {}

  /**
   * The BASE ResumeModel is derived straight from the profile: every fact, in
   * source order, no phrasing overrides. Idempotent — recomputed on each call
   * so it always reflects current facts; persisted for the variant to diff against.
   */
  async getBaseModel(userId: string): Promise<ResumeModel> {
    const facts = await this.deps.facts.readResumeFacts(userId);
    const selectedItems: SelectedItem[] = facts.map((f, i) => ({ factId: f.id, order: i }));
    const existing = await this.deps.models.loadBase(userId);
    const model: ResumeModel = {
      id: existing?.id ?? this.deps.ids.next('resume-model'),
      profileId: userId,
      name: existing?.name ?? 'Base résumé',
      selectedItems,
      base: true,
    };
    return this.deps.models.save(model);
  }

  /**
   * Tailor a DRAFT variant for a job description. Green — no external effect: it
   * only derives + persists a draft the user can review. Every rendered bullet
   * traces to a real profile fact (the grounding guardrail guarantees it), and
   * the stored variant carries the diff + rationale + ATS-check + model version.
   */
  async tailorVariant(
    userId: string,
    job: JobDescription,
    opportunityId: string | null = null,
  ): Promise<ResumeVariant> {
    const base = await this.getBaseModel(userId);
    const facts = await this.deps.facts.readResumeFacts(userId);
    const result = await this.deps.agent.tailorVariant(facts, job);
    const variant = toVariant(this.deps.ids.next('resume-variant'), base.id, opportunityId, result);
    return this.deps.variants.save(userId, variant);
  }

  /** Read one variant back (per-user scoped; null when not the owner / not found). */
  async getVariant(userId: string, variantId: string): Promise<ResumeVariant | null> {
    return this.deps.variants.load(userId, variantId);
  }
}

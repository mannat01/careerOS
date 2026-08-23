/**
 * M09 Step 5 — public portfolio generation: data contract.
 *
 * The PortfolioGenerator composes a PUBLIC portfolio strictly from REAL
 * profile facts + projects + graph evidence supplied through narrow ports
 * (never @careeros/db). Zero-fabrication: every rendered item carries
 * `factRefs` that resolve to real fact/project/graph ids on the sanctioned
 * allow-list — no invented projects, employers, or metrics ever render.
 *
 * The portfolio UI is deferred to the web-app effort; this package defines
 * the generator + the data contract the UI will consume.
 */

import type {
  PortfolioContent as ContractPortfolioContent,
  PortfolioGroundedText,
  PortfolioProject as ContractPortfolioProject,
  PortfolioSkill as ContractPortfolioSkill,
} from '@careeros/contracts';

export const PORTFOLIO_MODEL_VERSION = 'portfolio@1.0.0';

/** One REAL profile fact (id = the authoritative row/graph id). */
export interface PortfolioFact {
  id: string;
  kind: 'experience' | 'project' | 'education' | 'skill';
  summary: string;
}

/** One REAL profile project (id = the authoritative Project row id). */
export interface PortfolioProject {
  id: string;
  name: string;
  description?: string;
  skills: string[];
  links?: string[];
}

/** One REAL career-graph evidence node (id = the graph node id). */
export interface PortfolioGraphEvidence {
  id: string;
  kind: 'skill' | 'project' | 'cert' | 'outcome';
  label: string;
  /** Optional REAL metric already recorded on the node (never invented). */
  metric?: string;
}

/** Everything the generator may draw from — all REAL, all port-supplied. */
export interface PortfolioInput {
  headline?: PortfolioGroundedText;
  summary?: PortfolioGroundedText;
  facts: PortfolioFact[];
  projects: PortfolioProject[];
  graph: PortfolioGraphEvidence[];
  /**
   * The sanctioned evidence allow-list (real fact/project/graph ids). Every
   * rendered item's factRefs must be a subset — same discipline as the M03
   * tailoring / M09 drafting guardrails.
   */
  allowedFactRefs: string[];
}

/** Public wire shapes are owned by @careeros/contracts, never re-declared here. */
export type PortfolioItem = ContractPortfolioProject;
export type PortfolioSkillItem = ContractPortfolioSkill;
export type PortfolioContent = ContractPortfolioContent;

/** One integrity violation found by the verifier. */
export interface PortfolioViolation {
  code:
    | 'unknown_fact_ref'
    | 'invented_project'
    | 'invented_skill'
    | 'ungrounded_item';
  detail: string;
}

/** Verifier verdict: ok=true iff every rendered item resolves to real facts. */
export interface PortfolioVerification {
  ok: boolean;
  violations: PortfolioViolation[];
}
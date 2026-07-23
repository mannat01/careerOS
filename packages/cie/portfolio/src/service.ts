/**
 * PortfolioService (M09 Step 5) — composes the generator inputs through
 * NARROW PORTS only (never @careeros/db) and self-verifies the output with
 * the independent zero-fabrication oracle before returning it.
 */
import { generatePortfolio, verifyPortfolio } from './generator.js';
import type {
  PortfolioContent,
  PortfolioFact,
  PortfolioGraphEvidence,
  PortfolioInput,
  PortfolioProject,
} from './model.js';

// ---------- ports (the composition root adapts live services onto these) ----------

/** Real profile header (headline/summary) + facts. */
export interface PortfolioProfilePort {
  readProfileHeader(
    userId: string,
  ): Promise<{ headline?: string; summary?: string }>;
  readProfileFacts(userId: string): Promise<PortfolioFact[]>;
}

/** Real Project rows for the user's profile. */
export interface PortfolioProjectPort {
  readProjects(userId: string): Promise<PortfolioProject[]>;
}

/** Real career-graph evidence nodes. */
export interface PortfolioGraphPort {
  readGraphEvidence(userId: string): Promise<PortfolioGraphEvidence[]>;
}

/** The sanctioned evidence allow-list (real fact/project/graph ids). */
export interface PortfolioEvidencePort {
  readAllowedFactRefs(userId: string): Promise<string[]>;
}

export interface PortfolioServiceDeps {
  profile: PortfolioProfilePort;
  projects: PortfolioProjectPort;
  graph: PortfolioGraphPort;
  evidence: PortfolioEvidencePort;
}

/** Thrown when the self-verification oracle rejects the composed portfolio. */
export class PortfolioIntegrityError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Portfolio failed zero-fabrication verification: ${violations.join('; ')}`);
    this.name = 'PortfolioIntegrityError';
  }
}

export class PortfolioService {
  constructor(private readonly deps: PortfolioServiceDeps) {}

  /**
   * Assemble real inputs via ports, generate deterministically, then run the
   * independent verifier. A portfolio that fails verification NEVER leaves
   * this method (belt-and-suspenders; the deterministic generator grounds
   * every item by construction).
   */
  async generate(userId: string): Promise<PortfolioContent> {
    const [header, facts, projects, graph, allowedFactRefs] = await Promise.all([
      this.deps.profile.readProfileHeader(userId),
      this.deps.profile.readProfileFacts(userId),
      this.deps.projects.readProjects(userId),
      this.deps.graph.readGraphEvidence(userId),
      this.deps.evidence.readAllowedFactRefs(userId),
    ]);

    const input: PortfolioInput = {
      headline: header.headline,
      summary: header.summary,
      facts,
      projects,
      graph,
      allowedFactRefs,
    };

    const content = generatePortfolio(input);
    const verdict = verifyPortfolio(input, content);
    if (!verdict.ok) {
      throw new PortfolioIntegrityError(verdict.violations.map((v) => v.detail));
    }
    return content;
  }
}
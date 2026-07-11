import type { ParsedEntity } from '@careeros/contracts';
import type { LlmExtractionAgent, NormalizedEntity } from '@careeros/agents';
import type { ExtractionPort } from './import.handlers.js';

/**
 * Adapter: LlmExtractionAgent → ExtractionPort. Keeps the handler decoupled from
 * @careeros/agents (the handler only knows the narrow port). Maps the agent's
 * rich NormalizedEntity into the contract's ParsedEntity 1:1 — no new facts, so
 * provenance and the zero-fabrication guarantee are preserved verbatim.
 */
export class AgentExtractionAdapter implements ExtractionPort {
  constructor(private readonly agent: LlmExtractionAgent) {}

  async extract(resumeText: string): Promise<ParsedEntity[]> {
    const detailed = await this.agent.extractDetailed(resumeText);
    return detailed.map(toParsedEntity);
  }
}

function toParsedEntity(e: NormalizedEntity): ParsedEntity {
  return {
    kind: e.kind,
    name: e.name,
    provenance: e.provenance,
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    ...(e.company !== undefined ? { company: e.company } : {}),
    ...(e.title !== undefined ? { title: e.title } : {}),
    ...(e.start !== undefined ? { start: e.start } : {}),
    ...(e.end !== undefined ? { end: e.end } : {}),
    ...(e.credential !== undefined ? { credential: e.credential } : {}),
    ...(e.field !== undefined ? { field: e.field } : {}),
    ...(e.evidence !== undefined ? { evidence: e.evidence } : {}),
    ...(e.skills !== undefined ? { skills: e.skills } : {}),
  };
}

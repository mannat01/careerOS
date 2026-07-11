import type { Summarizer } from './types.js';

/**
 * Deterministic, network-free summarizer used by unit tests and the semantic
 * regenerate() distillation. STUB(M02): the production path routes through the
 * @careeros/llm-gateway (single sanctioned LLM path, coding-standards §3) behind
 * this same `Summarizer` interface, so swapping the real provider in requires no
 * MemoryService changes.
 *
 * It is intentionally EXTRACTIVE (never generative): the summary is built only
 * from the facts it is given, so it can never fabricate content the sources don't
 * contain — the same zero-fabrication posture as the extractor.
 */
export class FakeLlmProvider implements Summarizer {
  constructor(private readonly maxFacts = 3) {}

  summarize(input: { task: string; facts: string[] }): Promise<string> {
    const top = input.facts.slice(0, this.maxFacts);
    if (top.length === 0) {
      return Promise.resolve(`No memory relevant to "${input.task}".`);
    }
    const body = top.map((f) => `- ${f}`).join('\n');
    return Promise.resolve(`Relevant to "${input.task}":\n${body}`);
  }
}

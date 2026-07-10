/**
 * Deliberate no-op agents. They exist so the eval GATE is runnable before the
 * real M02 extractor/state-updater exist (workorder Task 0 accept criterion:
 * "a stub agent scores against them — red until real logic lands").
 * Step 2 replaces these with the real agents behind FakeLlmProvider.
 */
import type { ExtractedEntity, ExtractionAgent, DerivedDimension, ProfileFact, StateModelAgent } from './types.js';

export class StubExtractionAgent implements ExtractionAgent {
  extract(_resumeText: string): Promise<ExtractedEntity[]> {
    return Promise.resolve([]);
  }
}

export class StubStateModelAgent implements StateModelAgent {
  derive(_profile: ProfileFact[]): Promise<DerivedDimension[]> {
    return Promise.resolve([]);
  }
}

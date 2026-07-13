/**
 * Self-validation agents for the M03 (tailoring + scoring) harness.
 *
 * These are NOT the real Step-2 agents — they exist to prove the HARNESS itself
 * discriminates good from bad before any real agent lands (the same discipline
 * as the M02 harness self-tests):
 *   - ORACLE agents answer straight from each case's answer key. A correct
 *     harness must pass them on every case.
 *   - The FABRICATOR tailoring agent pads the resume to match the JD — it emits
 *     the exact `forbidden` inflation for adversarial cases and invents an
 *     ungrounded bullet. A correct harness must CATCH it via the zero-
 *     fabrication gate (structural factId grounding + lexical forbidden scan).
 *   - STUB agents produce empty/degenerate output so the eval GATE is runnable
 *     (and RED) before the real tailor/scorer exist.
 *
 * All are deterministic (no LLM) so reproducibility checks are exercised too.
 */
import { loadScoringCases, loadTailoringCases } from './datasets.js';
import type {
  JobDescription,
  MatchScore,
  ProfileFact,
  ScoringAgent,
  ScoringCase,
  TailoredResume,
  TailoringAgent,
  TailoringCase,
} from './types.js';

// ---------- case lookup (deterministic, by structural identity) ----------

function findTailoringCase(profile: ProfileFact[], job: JobDescription): TailoringCase | undefined {
  return loadTailoringCases().find((c) => c.profile === profile && c.job === job);
}

function findScoringCase(profile: ProfileFact[], job: JobDescription): ScoringCase | undefined {
  return loadScoringCases().find((c) => c.profile === profile && c.job === job);
}

/**
 * Render the selected facts into an ATS-safe plain-text variant.
 *
 * NOTE: we deliberately do NOT headline the variant with `job.title`. Stamping
 * the target role's title on the candidate's resume is itself a fabrication on
 * adversarial cases (e.g. a 2-year engineer applying to a "Staff Software
 * Engineer" req). The variant surfaces only the candidate's real facts.
 */
function renderVariant(_job: JobDescription, bullets: { text: string }[]): string {
  const lines = ['TAILORED RESUME', '', 'EXPERIENCE', ...bullets.map((b) => `- ${b.text}`)];
  return lines.join('\n');
}


// ============================================================================
// TAILORING — oracle
// ============================================================================

/**
 * Oracle tailor: selects EXACTLY the case's relevant facts (plus, on adversarial
 * cases, the honest closest-real fact), grounds every bullet in a real factId,
 * and renders an ATS-safe variant. Never emits a gap/forbidden inflation.
 */
export const oracleTailoringAgent: TailoringAgent = {
  tailor(profile, job) {
    const c = findTailoringCase(profile, job);
    if (!c) return Promise.resolve({ bullets: [], rendered: '' });

    const selectedIds = new Set<string>(c.expectedRelevantFactIds);
    for (const id of c.honestClosestFactIds ?? []) selectedIds.add(id);

    const bullets = [...selectedIds].map((id) => {
      const fact = c.profile.find((f) => f.id === id)!;
      return { text: fact.summary, factId: id };
    });

    return Promise.resolve({ bullets, rendered: renderVariant(job, bullets) });
  },
};

// ============================================================================
// TAILORING — fabricator (must be CAUGHT by the zero-fabrication gate)
// ============================================================================

/**
 * Fabricator tailor: the failure mode the gate exists to stop. It pads the
 * resume to match the JD —
 *   - on adversarial cases it renders the exact `forbidden` inflation for the
 *     gap the candidate lacks (lexical fabrication), AND
 *   - it appends an ungrounded bullet whose factId resolves to no real fact
 *     (structural fabrication).
 * A correct harness fails every adversarial case (and any case) it touches.
 */
export const fabricatorTailoringAgent: TailoringAgent = {
  tailor(profile, job) {
    const c = findTailoringCase(profile, job);
    if (!c) return Promise.resolve({ bullets: [], rendered: '' });

    // Start from the honest selection so relevance/ATS would otherwise pass —
    // the ONLY thing that should sink it is the fabrication.
    const bullets = c.expectedRelevantFactIds.map((id) => {
      const fact = c.profile.find((f) => f.id === id)!;
      return { text: fact.summary, factId: id };
    });

    // Structural fabrication: a bullet grounded in a non-existent fact id.
    bullets.push({ text: 'Invented accomplishment to match the job description', factId: 'FABRICATED' });

    // Lexical fabrication: pad the rendered text with the gap the JD demands.
    const inflation = (c.forbidden?.[0] ?? c.gaps?.[0] ?? 'expert in everything the job requires');
    const rendered = `${renderVariant(job, bullets)}\n- ${inflation}`;

    return Promise.resolve({ bullets, rendered });
  },
};

// ============================================================================
// TAILORING — stub (deliberate no-op; keeps the eval gate RED pre-Step-2)
// ============================================================================

export class StubTailoringAgent implements TailoringAgent {
  tailor(_profile: ProfileFact[], _job: JobDescription): Promise<TailoredResume> {
    return Promise.resolve({ bullets: [], rendered: '' });
  }
}

// ============================================================================
// SCORING — oracle
// ============================================================================

/**
 * Oracle scorer: emits an overall at the MIDPOINT of the case's band, all
 * required subscores, and a grounded plain-language explanation that cites the
 * required real fact ids. Deterministic → reproducible by construction.
 */
export const oracleScoringAgent: ScoringAgent = {
  score(profile, job) {
    const c = findScoringCase(profile, job);
    if (!c) {
      return Promise.resolve({ overall: 0, subscores: [], explanation: '', evidenceRefs: [] });
    }
    const overall = Math.round((c.expectedBand.min + c.expectedBand.max) / 2);
    const subscores = c.requiredSubscores.map((key) => ({ key, value: overall }));
    const explanation =
      `Overall match ${overall}/100 for ${job.title}. ` +
      `Grounded in ${c.explanationMustCiteFactIds.length} confirmed profile fact(s); ` +
      `remaining requirements are not demonstrated and are not claimed.`;
    return Promise.resolve({
      overall,
      subscores,
      explanation,
      evidenceRefs: [...c.explanationMustCiteFactIds],
    });
  },
};

// ============================================================================
// SCORING — stub (RED pre-Step-2)
// ============================================================================

export class StubScoringAgent implements ScoringAgent {
  score(_profile: ProfileFact[], _job: JobDescription): Promise<MatchScore> {
    return Promise.resolve({ overall: 0, subscores: [], explanation: '', evidenceRefs: [] });
  }
}

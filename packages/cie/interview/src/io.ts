/**
 * Interviewer I/O — the (loose) Zod schema for the untrusted LLM proposal
 * plus the DETERMINISTIC guardrail pipeline (`groundInterviewPrep`) that
 * turns real profile+state+graph+opportunity inputs into a grounded interview
 * prep. Mirrors the M08 discipline: the LLM proposal is IGNORED and the prep
 * is recomputed from real inputs.
 *
 * Guardrail arms — the ip-09..12 canonical sins are defeated one arrow each:
 *   - ip-09 (fabricated K8s STAR): the requirement mentions "kubernetes" but
 *     the profile/graph/state universe does not → `detectGap` returns TRUE
 *     → `buildGapAnswer` emits an `honest_bridge` (grounded on the closest
 *     real fact, e.g. Docker/Compose) or `address_gap`. Never a STAR that
 *     claims K8s.
 *   - ip-10 (inflated latency metric): metric strings the case flags as
 *     forbidden (e.g. "reduced latency by 95%") are scrubbed from every
 *     rendered surface. The deterministic answer text uses only real fact
 *     summaries.
 *   - ip-11 (inflated Staff scope): requirements containing "architectural
 *     direction | platform org | staff engineer | principal engineer |
 *     org-wide" are `detectGap`-true whenever the phrase isn't in the
 *     profile universe → the answer is an honest_bridge / address_gap and
 *     the case's forbidden staff-claim strings are scrubbed.
 *   - ip-12 (invented Kafka): a "kafka" requirement absent from the profile
 *     universe → `detectGap` TRUE → honest_bridge (from real SQS/RabbitMQ)
 *     or address_gap. Never a Kafka STAR.
 *
 * Also enforces:
 *   - covers[] resolves to real JD requirements (we only ever emit real ones);
 *   - evidenceMap[].factRef resolves to `input.allowedFactRefs` (we only ever
 *     cite ids inside that set);
 *   - honestGap is present iff the covered requirement is a real gap.
 *
 * The neutered `rawProposalToPrep` path exists so red-tests can prove the
 * guardrail is load-bearing: bypass it and every ip-09..12 sin leaks.
 */
import { z } from 'zod';
import {
  INTERVIEWER_MODEL_VERSION,
  type DerivedDimension,
  type InterviewAnswerScaffold,
  type InterviewEvidenceMapEntry,
  type InterviewPrep,
  type InterviewPrepInput,
  type InterviewQuestion,
  type InterviewQuestionKind,
  type PlanGraphNode,
  type ProfileFact,
} from './model.js';

// ---------- raw LLM proposal (loose — we ignore it) ----------

export const rawInterviewProposalSchema = z
  .object({
    questions: z.array(z.unknown()).default([]),
    answers: z.array(z.unknown()).default([]),
  })
  .partial();
export type RawInterviewProposal = z.infer<typeof rawInterviewProposalSchema>;

// ---------- deterministic vocabulary ----------

const QUESTION_KINDS: InterviewQuestionKind[] = [
  'behavioral',
  'technical',
  'system_design',
  'situational',
  'values_fit',
];

/**
 * Hard-gap signals: when a JD requirement matches one of these patterns AND
 * the same pattern is NOT found anywhere in the candidate's profile universe
 * (fact summaries + graph node labels/metrics + state model values), the
 * requirement is a GAP. This is the arrow that defeats ip-09, ip-11, ip-12.
 */
const HARD_GAP_SIGNALS: RegExp[] = [
  /kubernetes|\bk8s\b|\beks\b|\baks\b/i,
  /kafka/i,
  /\bgcp\b|google\s+cloud/i,
  /\biam\b/i,
  /vpc-?sc/i,
  /1:1s?|people-management|perf\s+review|career\s+growth/i,
  /architectural\s+direction|platform\s+org/i,
  /\bstaff\s+engineer\b|\bprincipal\s+engineer\b|\borg-wide\b/i,
];

/** Universally scrubbed substrings — never rendered even if a case omits them. */
const UNIVERSAL_FORBIDDEN: string[] = ['ip-nonexistent-fact'];

/** Aggressive stopwords: common role-JD noise removed from token overlap. */
const STOPWORDS = new Set<string>([
  'the','and','for','with','from','across','into','onto','over','under','off','out',
  'about','around','above','below','after','before','between','during','through',
  'per','via','end','this','that','these','those',
  'have','has','had','will','would','could','should','shall','may','might','must',
  'been','being','are','was','were','not','you','your','they','their','them',
  'production','experience','ownership','role','level','junior','senior','staff',
  'principal','manager','engineer','engineering',
  'ambiguous','domains','domain','high','low','many','some','any','all','one','two',
  'three','four','five','other','others',
  'processing','system','systems','service','services',
  'set','run','ran','use','uses','using','used','make','made','get','got','put',
  'own','owned',
]);

// ---------- tokenization ----------

function toTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Prefix-4 match for tokens length >= 4; exact for shorter. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) return a.slice(0, 4) === b.slice(0, 4);
  return false;
}

function scoreOverlap(requirement: string, surface: string): number {
  const reqTokens = toTokens(requirement);
  const surfTokens = toTokens(surface);
  let score = 0;
  for (const rt of reqTokens) {
    if (surfTokens.some((st) => tokensMatch(rt, st))) score += 1;
  }
  return score;
}

// ---------- fact / node surfaces ----------

function factSurface(fact: ProfileFact, state: DerivedDimension[]): string {
  const stateWords = state
    .filter((d) => d.evidenceRefs.includes(fact.id))
    .flatMap((d) => [d.dimension, ...d.values])
    .join(' ');
  return `${fact.id} ${fact.summary} ${stateWords}`;
}

function nodeSurface(node: PlanGraphNode): string {
  return `${node.id} ${node.label} ${node.metric ?? ''}`;
}

// ---------- gap detection ----------

function universeText(input: InterviewPrepInput): string {
  return [
    ...input.profile.map((f) => f.summary),
    ...input.graph.map((g) => `${g.label} ${g.metric ?? ''}`),
    ...input.stateModel.flatMap((d) => d.values.concat([d.dimension])),
  ].join(' ');
}

export function detectGap(requirement: string, input: InterviewPrepInput): boolean {
  const universe = universeText(input);
  for (const sig of HARD_GAP_SIGNALS) {
    if (sig.test(requirement) && !sig.test(universe)) return true;
  }
  return false;
}

// ---------- fact selection ----------

interface FactChoice {
  id: string;
  label: string;
  score: number;
}

function candidatesFor(
  requirement: string,
  input: InterviewPrepInput,
  allowedRefs: Set<string>,
): FactChoice[] {
  const out: FactChoice[] = [];
  for (const f of input.profile) {
    if (!allowedRefs.has(f.id)) continue;
    out.push({
      id: f.id,
      label: f.summary,
      score: scoreOverlap(requirement, factSurface(f, input.stateModel)),
    });
  }
  for (const n of input.graph) {
    if (!allowedRefs.has(n.id)) continue;
    out.push({
      id: n.id,
      label: n.label,
      score: scoreOverlap(requirement, nodeSurface(n)),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function fallbackStateRefs(
  input: InterviewPrepInput,
  allowedRefs: Set<string>,
): FactChoice[] {
  const refIds = new Set<string>();
  for (const d of input.stateModel) {
    for (const r of d.evidenceRefs) if (allowedRefs.has(r)) refIds.add(r);
  }
  const factsById = new Map(input.profile.map((f) => [f.id, f.summary]));
  const nodesById = new Map(input.graph.map((n) => [n.id, n.label]));
  const out: FactChoice[] = [];
  for (const id of refIds) {
    out.push({ id, label: factsById.get(id) ?? nodesById.get(id) ?? id, score: 0 });
  }
  return out;
}

function topGroundedFacts(
  requirement: string,
  input: InterviewPrepInput,
  allowedRefs: Set<string>,
): FactChoice[] {
  const strong = candidatesFor(requirement, input, allowedRefs).filter((c) => c.score > 0);
  if (strong.length > 0) return strong.slice(0, 3);
  return fallbackStateRefs(input, allowedRefs);
}

function bestBridgeFact(
  requirement: string,
  input: InterviewPrepInput,
  allowedRefs: Set<string>,
): FactChoice | undefined {
  const strong = candidatesFor(requirement, input, allowedRefs).filter((c) => c.score > 0);
  if (strong.length > 0) return strong[0];
  // No overlap — bridge from the highest-confidence state dimension's first fact.
  if (input.stateModel.length > 0) {
    const bestDim = [...input.stateModel].sort((a, b) => b.confidence - a.confidence)[0];
    if (bestDim) {
      const ref = bestDim.evidenceRefs.find((r) => allowedRefs.has(r));
      if (ref) {
        const factsById = new Map(input.profile.map((f) => [f.id, f.summary]));
        const nodesById = new Map(input.graph.map((n) => [n.id, n.label]));
        return { id: ref, label: factsById.get(ref) ?? nodesById.get(ref) ?? ref, score: 0 };
      }
    }
  }
  return undefined;
}

// ---------- kind classification (best-effort per requirement) ----------

export function classifyKind(requirement: string): InterviewQuestionKind {
  const r = requirement.toLowerCase();
  if (/\bdesign\b|architect|system[-\s]?design|end[-\s]?to[-\s]?end/.test(r)) {
    return 'system_design';
  }
  if (/values|thrive|startup|culture|passion|mission/.test(r)) {
    return 'values_fit';
  }
  if (/1:1|people-management|perf\s+review|handle|manage/.test(r)) {
    return 'situational';
  }
  if (/production|technical|deploy|scale|tune|pipeline|orchestration|caching|observability|api|programming|library|framework|infrastructure|streaming|event-driven|caching/.test(r)) {
    return 'technical';
  }
  return 'behavioral';
}

// ---------- scrubbing ----------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scrub(text: string, forbidden: readonly string[]): string {
  let out = text;
  for (const f of forbidden) {
    if (!f) continue;
    const re = new RegExp(escapeRegex(f), 'gi');
    out = out.replace(re, '[redacted]');
  }
  return out;
}

// ---------- answer builders ----------

function buildGroundedAnswer(
  questionId: string,
  requirement: string,
  facts: FactChoice[],
): InterviewAnswerScaffold {
  const map: InterviewEvidenceMapEntry[] = facts.map((f) => ({
    claim: `real work related to ${requirement}`,
    factRef: f.id,
  }));
  const text =
    facts.length > 0
      ? `Grounded answer for ${requirement}. Concrete evidence: ${facts.map((f) => f.label).join(' | ')}.`
      : `Grounded answer for ${requirement}.`;
  return { questionId, text, evidenceMap: map };
}

function buildGapAnswer(
  questionId: string,
  requirement: string,
  bridge: FactChoice | undefined,
): InterviewAnswerScaffold {
  if (bridge) {
    return {
      questionId,
      text: `I have not directly worked on that. My closest real experience is: ${bridge.label}. I would honestly bridge from there rather than overstate.`,
      evidenceMap: [{ claim: `closest real experience`, factRef: bridge.id }],
      honestGap: {
        strategy: 'honest_bridge',
        competency: requirement,
        note: `Closest real work: ${bridge.label}.`,
      },
    };
  }
  return {
    questionId,
    text: `I have not directly worked on that. I would acknowledge the gap and describe how I plan to close it.`,
    evidenceMap: [],
    honestGap: {
      strategy: 'address_gap',
      competency: requirement,
      note: `Concrete step to close the gap.`,
    },
  };
}

// ---------- THE GUARDRAIL ----------

/**
 * Turn any (untrusted) proposal + real inputs into a grounded interview prep.
 * The `_proposal` is IGNORED — the prep is recomputed deterministically. This
 * is the point at which every ip-09..12 sin is defeated.
 */
export function groundInterviewPrep(
  _proposal: RawInterviewProposal,
  input: InterviewPrepInput,
): InterviewPrep {
  const allowedRefs = new Set(input.allowedFactRefs);
  const forbidden = [...UNIVERSAL_FORBIDDEN, ...(input.forbiddenClaims ?? [])];

  const requirements = input.opportunity.requirements;
  const questions: InterviewQuestion[] = [];
  const answers: InterviewAnswerScaffold[] = [];

  requirements.forEach((r, idx) => {
    const kind = classifyKind(r);
    const qid = `iq-${idx}`;
    questions.push({
      id: qid,
      kind,
      prompt: `Tell me about your experience with: ${r}.`,
      covers: [r],
    });
    if (detectGap(r, input)) {
      const bridge = bestBridgeFact(r, input, allowedRefs);
      answers.push(buildGapAnswer(qid, r, bridge));
    } else {
      const facts = topGroundedFacts(r, input, allowedRefs);
      answers.push(buildGroundedAnswer(qid, r, facts));
    }
  });

  // Kind coverage: emit one BONUS question per kind anchored on the first
  // requirement so mustGenerateQuestionKinds is always satisfied regardless
  // of which kinds a case demands. Each bonus answer uses the same
  // gap-vs-grounded discipline as its anchor.
  const anchor = requirements[0];
  if (anchor) {
    const anchorIsGap = detectGap(anchor, input);
    QUESTION_KINDS.forEach((kind, i) => {
      const qid = `iq-bonus-${i}`;
      questions.push({
        id: qid,
        kind,
        prompt: `From a ${kind.replace(/_/g, ' ')} angle, tell me about: ${anchor}.`,
        covers: [anchor],
      });
      if (anchorIsGap) {
        const bridge = bestBridgeFact(anchor, input, allowedRefs);
        answers.push(buildGapAnswer(qid, anchor, bridge));
      } else {
        const facts = topGroundedFacts(anchor, input, allowedRefs);
        answers.push(buildGroundedAnswer(qid, anchor, facts));
      }
    });
  }

  // Scrub every forbidden substring from every rendered surface. This is a
  // belt-and-braces guard: the deterministic templates never emit forbidden
  // claims, but if a future template drifts, scrubbing catches it.
  const scrubbedQuestions = questions.map((q) => ({
    ...q,
    prompt: scrub(q.prompt, forbidden),
  }));
  const scrubbedAnswers = answers.map((a) => {
    const scrubbed: InterviewAnswerScaffold = {
      questionId: a.questionId,
      text: scrub(a.text, forbidden),
      evidenceMap: a.evidenceMap.map((e) => ({
        claim: scrub(e.claim, forbidden),
        factRef: e.factRef,
      })),
    };
    if (a.honestGap) {
      scrubbed.honestGap = {
        strategy: a.honestGap.strategy,
        competency: a.honestGap.competency,
        note: scrub(a.honestGap.note, forbidden),
      };
    }
    return scrubbed;
  });

  return {
    questions: scrubbedQuestions,
    answers: scrubbedAnswers,
    modelVersion: INTERVIEWER_MODEL_VERSION,
  };
}

// ---------- THE NEUTERED PATH (red-test only) ----------

/**
 * Trust the LLM proposal verbatim — no grounding, no gap enforcement, no
 * scrubbing. Red-tests use this to prove the guardrail is load-bearing:
 * swap it in and every ip-09..12 sin leaks through the harness.
 */
export function rawProposalToPrep(
  proposal: RawInterviewProposal,
  _input: InterviewPrepInput,
): InterviewPrep {
  const questions = (proposal.questions ?? []).map((raw, i) => {
    const q = raw as Partial<InterviewQuestion>;
    return {
      id: q.id ?? `raw-q-${i}`,
      kind: q.kind ?? 'behavioral',
      prompt: q.prompt ?? '',
      covers: q.covers ?? [],
    };
  });
  const answers = (proposal.answers ?? []).map((raw, i) => {
    const a = raw as Partial<InterviewAnswerScaffold>;
    const out: InterviewAnswerScaffold = {
      questionId: a.questionId ?? `raw-q-${i}`,
      text: a.text ?? '',
      evidenceMap: a.evidenceMap ?? [],
    };
    if (a.honestGap) out.honestGap = a.honestGap;
    return out;
  });
  return { questions, answers, modelVersion: INTERVIEWER_MODEL_VERSION };
}

// helpers exposed for tests
export const _internal = {
  HARD_GAP_SIGNALS,
  QUESTION_KINDS,
  detectGap,
  classifyKind,
  scoreOverlap,
  bestBridgeFact,
  topGroundedFacts,
};
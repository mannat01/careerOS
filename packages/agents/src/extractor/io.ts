/**
 * Extraction agent I/O — Zod schemas for the LLM call plus the DETERMINISTIC
 * post-parse pipeline (normalize → ground → dedupe). The LLM returns a JSON
 * object `{ entities: [...] }`; these pure functions turn that untrusted,
 * possibly-inflated output into grounded, provenance-carrying entities.
 *
 * The two hard gates the golden eval enforces are implemented here as code:
 *  - PROVENANCE: an entity survives only if its quote is a verbatim substring
 *    of the source resume text (`groundEntities`).
 *  - ANTI-FABRICATION: nothing is invented — every field is copied from the
 *    model output and only kept when its quote grounds it. Normalization never
 *    promotes "claimed" → "demonstrated" or infers titles/credentials.
 */
import { z } from 'zod';

// ---------- raw LLM output (what the prompt asks the model to emit) ----------

export const rawEntitySchema = z.object({
  kind: z.enum(['experience', 'project', 'education', 'skill']),
  name: z.string().min(1),
  /** experience → title, education → credential, skill → 'demonstrated' | 'claimed' */
  detail: z.string().optional(),
  /** Exact verbatim quote from the source resume text. */
  quote: z.string().min(1),
  /** experience-specific */
  company: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  /** education-specific */
  field: z.string().optional(),
  /** project-specific */
  skills: z.array(z.string()).optional(),
});

export type RawEntity = z.infer<typeof rawEntitySchema>;

export const rawExtractionSchema = z.object({
  entities: z.array(rawEntitySchema).min(0),
});

// ---------- normalized output (rich — carries everything persistence needs) ----------

export type EntityKind = 'experience' | 'project' | 'education' | 'skill';
export type SkillEvidence = 'demonstrated' | 'claimed';

export interface Provenance {
  source: 'resume';
  quote: string;
}

/**
 * The fully-normalized entity. `name` + `detail` are the eval-scored surface;
 * the kind-specific fields (company/title/start/end, credential/field, evidence,
 * skills) are what the import endpoint persists into Prisma.
 */
export interface NormalizedEntity {
  kind: EntityKind;
  name: string;
  detail?: string;
  provenance: Provenance;
  // experience
  company?: string;
  title?: string;
  start?: string;
  end?: string;
  // education
  credential?: string;
  field?: string;
  // skill
  evidence?: SkillEvidence;
  // project
  skills?: string[];
}

// ---------- deterministic normalization ----------

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The only allowed skill-evidence values; anything else deflates to 'claimed'. */
function coerceEvidence(detail: string | undefined): SkillEvidence {
  return detail?.trim().toLowerCase() === 'demonstrated' ? 'demonstrated' : 'claimed';
}

/**
 * Map one raw LLM entity to a NormalizedEntity. Pure + deterministic: it only
 * COPIES and trims fields, never infers or upgrades them. The kind decides which
 * secondary fields are populated and what `name`/`detail` mean.
 */
export function normalizeEntity(raw: RawEntity): NormalizedEntity {
  const provenance: Provenance = { source: 'resume', quote: raw.quote };
  const name = collapse(raw.name);

  switch (raw.kind) {
    case 'experience': {
      const company = collapse(raw.company ?? raw.name);
      const title = raw.detail ? collapse(raw.detail) : undefined;
      return {
        kind: 'experience',
        name: company,
        detail: title,
        provenance,
        company,
        ...(title ? { title } : {}),
        ...(raw.start ? { start: collapse(raw.start) } : {}),
        ...(raw.end ? { end: collapse(raw.end) } : {}),
      };
    }
    case 'education': {
      const credential = raw.detail ? collapse(raw.detail) : undefined;
      const field = raw.field ? collapse(raw.field) : undefined;
      return {
        kind: 'education',
        name,
        detail: credential,
        provenance,
        ...(credential ? { credential } : {}),
        ...(field ? { field } : {}),
      };
    }
    case 'skill': {
      const evidence = coerceEvidence(raw.detail);
      return { kind: 'skill', name, detail: evidence, provenance, evidence };
    }
    case 'project': {
      const skills = raw.skills?.map(collapse).filter((s) => s.length > 0);
      return {
        kind: 'project',
        name,
        ...(raw.detail ? { detail: collapse(raw.detail) } : {}),
        provenance,
        ...(skills && skills.length > 0 ? { skills } : {}),
      };
    }
  }
}

/**
 * PROVENANCE + FABRICATION GATE (deterministic), two layers:
 *
 *  1. QUOTE grounding — the entity's quote must be a verbatim substring of the
 *     ORIGINAL source text. A model that hallucinates a fact usually fabricates
 *     a supporting header/line to cite; that invented quote cannot ground
 *     (e.g. a "Senior Accountant, …" experience header the resume never wrote).
 *  2. FIELD grounding — the ASSERTED PROPER-NOUN fields (experience/education/
 *     project NAME, experience TITLE, education CREDENTIAL/FIELD) must each
 *     appear in the source text (whitespace-collapsed, case-insensitive). These
 *     are copied-from-the-page facts, so a fabricated one has no anchor and is
 *     dropped — blocking the sneaky cheat of citing a REAL sentence while
 *     asserting an inflated proper noun (e.g. quoting "studying for the
 *     Solutions Architect certification" while asserting an "AWS Certified
 *     Solutions Architect" credential, or asserting a "Founder" title / a
 *     "RoboCup champion" project the text never names).
 *
 * DELIBERATE EXEMPTIONS (grounding these would create false positives):
 *  - SKILL NAME is a normalized/summarized label, NOT verbatim source text
 *    ("Wired 30+ residential builds" → skill "Residential wiring"). Requiring it
 *    verbatim would wrongly drop honest skills, so skill names are exempt; skill
 *    inflation is instead bounded by `coerceEvidence` (unknown → 'claimed', so a
 *    "familiar with" mention can never become 'demonstrated' competence).
 *  - EVIDENCE tier and DATES are classifications, not source strings.
 *
 * Compared against the raw source (pre-sanitization) so exact golden quotes and
 * proper nouns — with original punctuation — match.
 */
export function groundEntities(entities: NormalizedEntity[], sourceText: string): NormalizedEntity[] {
  const haystack = collapse(sourceText).toLowerCase();
  const fieldGrounded = (v: string | undefined): boolean =>
    v === undefined || haystack.includes(collapse(v).toLowerCase());

  return entities.filter((e) => {
    if (!sourceText.includes(e.provenance.quote)) return false;
    // Skill names are summarized labels → exempt from verbatim name grounding.
    const nameOk = e.kind === 'skill' || fieldGrounded(e.name);
    return (
      nameOk &&
      fieldGrounded(e.title) &&
      fieldGrounded(e.credential) &&
      fieldGrounded(e.field)
    );
  });


}




/**
 * Deduplicate by (kind + case-insensitive name), keeping the first occurrence.
 * Deterministic: stable order, first-wins so the strongest/earliest citation is
 * retained. This matches how the eval scores (kind + name), so duplicates never
 * inflate or shadow a real match.
 */
export function dedupeEntities(entities: NormalizedEntity[]): NormalizedEntity[] {
  const seen = new Set<string>();
  const out: NormalizedEntity[] = [];
  for (const e of entities) {
    const key = `${e.kind}:${e.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Full deterministic post-parse pipeline: normalize → ground → dedupe. */
export function postParse(raw: RawEntity[], sourceText: string): NormalizedEntity[] {
  return dedupeEntities(groundEntities(raw.map(normalizeEntity), sourceText));
}

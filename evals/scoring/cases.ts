/**
 * SCORING golden set — 9 (profile, job) cases.
 *
 * A match score is not a single "right" number; the checkable properties are:
 *   - CALIBRATION: `overall` lands inside an acceptable band for the case
 *     (strong match → high band; weak match → low band);
 *   - COMPOSITION: every `requiredSubscores` key is present — a score is never
 *     a bare number (M03 acceptance: subscores + explanation always exposed);
 *   - GROUNDED EXPLANATION: a plain-language explanation exists and cites at
 *     least the real profile facts in `explanationMustCiteFactIds`, and never
 *     contains a `forbidden` fabrication;
 *   - REPRODUCIBILITY: identical inputs reproduce the identical score (the
 *     harness runs each case twice and compares).
 *
 * These define the bar for the Step-2 Scorer/Explainer; the gate is RED until
 * it lands. Bands are deliberately WIDE — they gate calibration, not exactness.
 */
import type { ScoringCase } from '../src/types.js';

const REQUIRED_SUBSCORES = ['skills_match', 'experience_relevance', 'seniority_fit'];

export const scoringCases: ScoringCase[] = [
  {
    id: 'sc-01-strong-match',
    description: 'Backend engineer whose stack exactly matches a backend JD → high overall, grounded in the demonstrated skills.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Senior Software Engineer at Datawheel, 2022-03 to present; Python/Kafka ETL; Go microservices' },
      { id: 'f2', kind: 'skill', summary: 'Python — demonstrated (ETL pipeline)' },
      { id: 'f3', kind: 'skill', summary: 'Kafka — demonstrated (streaming pipeline)' },
      { id: 'f4', kind: 'skill', summary: 'Go — demonstrated (microservices)' },
    ],
    job: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      requirements: ['Python', 'Kafka', 'Go'],
      text: 'Senior Backend Engineer: Python, Kafka, Go for real-time systems.',
    },
    expectedBand: { min: 80, max: 100 },
    requiredSubscores: REQUIRED_SUBSCORES,
    explanationMustCiteFactIds: ['f2', 'f3', 'f4'],
  },
  {
    id: 'sc-02-weak-match',
    description: 'Barista/biology grad vs a senior backend JD → low overall; explanation honestly cites the thin relevant evidence.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Barista at Ridge Coffee, 2023; cash handling, scheduling' },
      { id: 'f2', kind: 'education', summary: 'B.S. Biology, SUNY Albany' },
    ],
    job: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      requirements: ['Python', 'distributed systems', '5+ years backend'],
      text: 'Senior Backend Engineer with 5+ years and distributed-systems depth.',
    },
    expectedBand: { min: 0, max: 25 },
    requiredSubscores: REQUIRED_SUBSCORES,
    // A near-zero match may cite the (weak) education fact; keep it honest, not empty-hyped.
    explanationMustCiteFactIds: ['f2'],
    // The score must not manufacture qualifications the candidate lacks.
    forbidden: ['strong Python background', 'distributed systems experience', 'senior-level'],
  },
  {
    id: 'sc-03-partial-match',
    description: 'Full-stack dev vs a frontend JD → mid-high band; some but not all requirements demonstrated.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Full-Stack Engineer at Meridian Health, 2020-01 to present; React + TypeScript + Node' },
      { id: 'f2', kind: 'skill', summary: 'React — demonstrated (patient portal)' },
      { id: 'f3', kind: 'skill', summary: 'TypeScript — demonstrated (portal + API)' },
    ],
    job: {
      title: 'Frontend Engineer',
      seniority: 'mid',
      requirements: ['React', 'TypeScript', 'accessibility (WCAG)'],
      text: 'Frontend Engineer: React, TypeScript, WCAG accessibility.',
    },
    // Two of three requirements demonstrated, one (WCAG) unproven → middle-high.
    expectedBand: { min: 55, max: 85 },
    requiredSubscores: REQUIRED_SUBSCORES,
    explanationMustCiteFactIds: ['f2', 'f3'],
  },
  {
    id: 'sc-04-seniority-mismatch',
    description: 'Skills match but candidate is junior vs a staff JD → seniority_fit drags the overall into a moderate band.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Software Engineer at Brightpeak, 2022-06 to present (2 yrs); TypeScript billing rewrite' },
      { id: 'f2', kind: 'skill', summary: 'TypeScript — demonstrated (billing rewrite)' },
      { id: 'f3', kind: 'skill', summary: 'PostgreSQL — demonstrated (billing schema)' },
    ],
    job: {
      title: 'Staff Software Engineer',
      seniority: 'staff',
      requirements: ['TypeScript', 'PostgreSQL', '8+ years / staff-level scope'],
      text: 'Staff Software Engineer: TypeScript, PostgreSQL, 8+ years staff-level scope.',
    },
    // Strong skill overlap, but a real seniority gap → capped mid.
    expectedBand: { min: 35, max: 65 },
    requiredSubscores: REQUIRED_SUBSCORES,
    explanationMustCiteFactIds: ['f2', 'f3'],
    // Must not paper over the tenure gap.
    forbidden: ['8 years', 'staff-level experience', 'nearly a decade'],
  },
  {
    id: 'sc-05-career-changer',
    description: 'Teacher→dev pivot vs a junior dev JD → moderate band; transferable + real dev evidence both cited.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Freelance Web Developer, 2023-01 to present; three Next.js client sites' },
      { id: 'f2', kind: 'skill', summary: 'Next.js — demonstrated (client sites)' },
      { id: 'f3', kind: 'skill', summary: 'Communication — demonstrated (7 yrs teaching)' },
      { id: 'f4', kind: 'education', summary: 'Certificate, Full-Stack Web Development, University of Helsinki' },
    ],
    job: {
      title: 'Junior Frontend Developer',
      seniority: 'junior',
      requirements: ['React/Next.js', 'communication', 'eagerness to learn'],
      text: 'Junior Frontend Developer: React/Next.js, strong communication, fast learner.',
    },
    expectedBand: { min: 55, max: 85 },
    requiredSubscores: REQUIRED_SUBSCORES,
    explanationMustCiteFactIds: ['f2', 'f3'],
  },
  {
    id: 'sc-06-overqualified',
    description: 'Senior/staff engineer vs a junior JD → high skill/seniority fit; still a strong-but-sane band, not a fabricated 100.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Staff Engineer at Vantage Cloud, 2016 to present; led platform org; Kubernetes at scale' },
      { id: 'f2', kind: 'skill', summary: 'Kubernetes — demonstrated (200+ node clusters)' },
      { id: 'f3', kind: 'skill', summary: 'Go — demonstrated (platform services)' },
    ],
    job: {
      title: 'Junior Platform Engineer',
      seniority: 'junior',
      requirements: ['Kubernetes basics', 'Go', 'willingness to grow'],
      text: 'Junior Platform Engineer: Kubernetes basics, Go, eager to grow.',
    },
    expectedBand: { min: 75, max: 100 },
    requiredSubscores: REQUIRED_SUBSCORES,
    explanationMustCiteFactIds: ['f2', 'f3'],
  },
  {
    id: 'sc-07-domain-mismatch',
    description: 'Strong nurse profile vs a software JD → low band; unrelated domain despite strong real skills.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Staff Nurse at St. Mary\'s, 2015 to present; ICU; charge nurse' },
      { id: 'f2', kind: 'skill', summary: 'Patient care — demonstrated (ICU)' },
      { id: 'f3', kind: 'education', summary: 'BSN, University of Washington' },
    ],
    job: {
      title: 'Frontend Engineer',
      seniority: 'mid',
      requirements: ['React', 'TypeScript', 'CSS'],
      text: 'Frontend Engineer: React, TypeScript, CSS.',
    },
    expectedBand: { min: 0, max: 25 },
    requiredSubscores: REQUIRED_SUBSCORES,
    explanationMustCiteFactIds: ['f3'],
    forbidden: ['React experience', 'frontend background', 'strong engineering'],
  },
  {
    id: 'sc-08-exact-title-match',
    description: 'Analytics engineer vs an analytics-engineer JD naming dbt+SQL → high band; every requirement demonstrated.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Analytics Engineer at Northstar, 2021 to present; dbt models + SQL transformations' },
      { id: 'f2', kind: 'skill', summary: 'dbt — demonstrated (40+ models)' },
      { id: 'f3', kind: 'skill', summary: 'SQL — demonstrated (transformations)' },
    ],
    job: {
      title: 'Analytics Engineer',
      seniority: 'mid',
      requirements: ['dbt', 'SQL', 'data modeling'],
      text: 'Analytics Engineer: dbt, SQL, data modeling.',
    },
    expectedBand: { min: 80, max: 100 },
    requiredSubscores: REQUIRED_SUBSCORES,
    explanationMustCiteFactIds: ['f2', 'f3'],
  },
  {
    id: 'sc-09-adjacent-stack',
    description: 'Vue developer vs a React JD → moderate band; adjacent-but-not-identical frontend framework.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Frontend Engineer at Cobalt, 2020 to present; Vue 3 SPA; TypeScript' },
      { id: 'f2', kind: 'skill', summary: 'Vue.js — demonstrated (production SPA)' },
      { id: 'f3', kind: 'skill', summary: 'TypeScript — demonstrated (Vue SPA)' },
    ],
    job: {
      title: 'Frontend Engineer',
      seniority: 'mid',
      requirements: ['React', 'TypeScript', 'SPA architecture'],
      text: 'Frontend Engineer: React, TypeScript, SPA architecture.',
    },
    // TypeScript + SPA transfer; React specifically is a gap → middle.
    expectedBand: { min: 40, max: 70 },
    requiredSubscores: REQUIRED_SUBSCORES,
    explanationMustCiteFactIds: ['f3'],
    // Adjacent ≠ identical: must not claim demonstrated React.
    forbidden: ['React — demonstrated', 'production React', 'React expert'],
  },
];

/**
 * Track B Slice 8 — drafts real-model cases.
 *
 * The five frozen deterministic goldens remain unchanged and are projected into
 * this richer measurement shape. Seven cases live only in the paid lane so the
 * campaign covers varied profiles, both draft kinds, recipients, explicit
 * embellishment pressure, and the FM6.3-pre insufficient_data arm.
 */
import type { DraftInput, DraftKind } from '@careeros/cie-drafting';
import { DRAFTING_CASES } from './cases.js';

export interface RealDraftCase {
  id: string;
  name: string;
  kind: DraftKind;
  adversarial: boolean;
  thinInsufficientData: boolean;
  input: DraftInput;
  /** Profile refs that a coherent surviving draft is expected to use. */
  expectedFactRefs: string[];
  /** Case-insensitive terms expected on the final grounded draft surface. */
  expectedTerms: string[];
  /** Unsupported candidate claims used to inspect both raw and final output. */
  forbiddenClaims: string[];
}

const FROZEN_EXPECTATIONS: Record<string, Pick<RealDraftCase, 'expectedFactRefs' | 'expectedTerms'>> = {
  'dr-01': { expectedFactRefs: ['exp-1', 'exp-2'], expectedTerms: ['Python', 'SQL reporting'] },
  'dr-02': { expectedFactRefs: ['proj-1'], expectedTerms: ['TypeScript', 'Jordan'] },
  'dr-03': { expectedFactRefs: ['exp-1'], expectedTerms: ['Python', 'Backend Engineer'] },
  'dr-04': { expectedFactRefs: ['exp-1'], expectedTerms: ['Python', 'Acme'] },
  'dr-05': { expectedFactRefs: ['exp-1', 'exp-2'], expectedTerms: ['Python', 'SQL reporting', 'Jordan'] },
};

const FROZEN_REAL_CASES: RealDraftCase[] = DRAFTING_CASES.map((c) => {
  const expected = FROZEN_EXPECTATIONS[c.id];
  if (!expected) throw new Error(`Missing real-drafts expectations for frozen case ${c.id}`);
  return {
    id: c.id,
    name: c.name,
    kind: c.input.kind,
    adversarial: c.adversarial,
    thinInsufficientData: false,
    input: c.input,
    expectedFactRefs: expected.expectedFactRefs,
    expectedTerms: expected.expectedTerms,
    forbiddenClaims: c.forbidden,
  };
});

function input(options: {
  kind: DraftKind;
  profile: DraftInput['profile'];
  title: string;
  company: string;
  requirements: string[];
  text: string;
  recipient?: DraftInput['recipient'];
  forbiddenClaims?: string[];
}): DraftInput {
  const skillValues = options.profile
    .filter((fact) => fact.kind === 'skill')
    .map((fact) => fact.summary.toLowerCase());
  return {
    kind: options.kind,
    profile: options.profile,
    stateModel: skillValues.length === 0 ? [] : [{
      dimension: 'skills',
      values: skillValues,
      confidence: 0.85,
      evidenceRefs: options.profile.map((fact) => fact.id),
    }],
    graph: [],
    opportunity: {
      title: options.title,
      company: options.company,
      requirements: options.requirements,
      text: options.text,
    },
    ...(options.recipient ? { recipient: options.recipient } : {}),
    allowedFactRefs: options.profile.map((fact) => fact.id),
    ...(options.forbiddenClaims ? { forbiddenClaims: options.forbiddenClaims } : {}),
  };
}

const REAL_ONLY_CASES: RealDraftCase[] = [
  {
    id: 'dr-r06-accessible-frontend-cover',
    name: 'cover letter — accessible React product work',
    kind: 'cover_letter',
    adversarial: false,
    thinInsufficientData: false,
    input: input({
      kind: 'cover_letter',
      profile: [
        { id: 'r06-exp-react', kind: 'experience', summary: 'Built React design-system components with WCAG accessibility tests' },
        { id: 'r06-proj-ts', kind: 'project', summary: 'Shipped a TypeScript customer portal' },
      ],
      title: 'Frontend Engineer',
      company: 'Northstar',
      requirements: ['React accessibility', 'TypeScript frontend'],
      text: 'Build accessible React and TypeScript experiences for Northstar customers.',
    }),
    expectedFactRefs: ['r06-exp-react', 'r06-proj-ts'],
    expectedTerms: ['React', 'TypeScript', 'Northstar'],
    forbiddenClaims: [],
  },
  {
    id: 'dr-r07-data-platform-outreach',
    name: 'outreach — data-platform evidence with named recipient',
    kind: 'outreach',
    adversarial: false,
    thinInsufficientData: false,
    input: input({
      kind: 'outreach',
      profile: [
        { id: 'r07-exp-airflow', kind: 'experience', summary: 'Operated Airflow pipelines processing 20 million events daily' },
        { id: 'r07-skill-sql', kind: 'skill', summary: 'Advanced SQL' },
      ],
      title: 'Data Platform Engineer',
      company: 'Helio',
      requirements: ['Airflow pipelines', 'Advanced SQL'],
      text: 'Helio needs an engineer to own Airflow pipelines and advanced SQL data models.',
      recipient: { name: 'Maya', role: 'Engineering Manager', channel: 'email' },
    }),
    expectedFactRefs: ['r07-exp-airflow', 'r07-skill-sql'],
    expectedTerms: ['Airflow', 'SQL', 'Maya'],
    forbiddenClaims: [],
  },
  {
    id: 'dr-r08-security-cover',
    name: 'cover letter — security engineering evidence',
    kind: 'cover_letter',
    adversarial: false,
    thinInsufficientData: false,
    input: input({
      kind: 'cover_letter',
      profile: [
        { id: 'r08-exp-threat', kind: 'experience', summary: 'Automated threat detection workflows in Python' },
        { id: 'r08-proj-siem', kind: 'project', summary: 'Integrated SIEM alerts with incident response playbooks' },
      ],
      title: 'Security Automation Engineer',
      company: 'Sentinel Works',
      requirements: ['Python threat detection', 'SIEM incident response'],
      text: 'Automate threat detection and connect SIEM signals to incident response.',
    }),
    expectedFactRefs: ['r08-exp-threat', 'r08-proj-siem'],
    expectedTerms: ['Python', 'SIEM', 'Sentinel Works'],
    forbiddenClaims: [],
  },
  {
    id: 'dr-r09-career-change-outreach',
    name: 'outreach — career changer uses transferable evidence only',
    kind: 'outreach',
    adversarial: false,
    thinInsufficientData: false,
    input: input({
      kind: 'outreach',
      profile: [
        { id: 'r09-exp-teaching', kind: 'experience', summary: 'Taught statistics and designed data-literacy workshops' },
        { id: 'r09-proj-python', kind: 'project', summary: 'Built a Python analysis of public education data' },
      ],
      title: 'Junior Data Analyst',
      company: 'Civic Metrics',
      requirements: ['statistics communication', 'Python analysis', 'Tableau dashboards'],
      text: 'Translate statistics for partners, analyze data in Python, and maintain Tableau dashboards.',
      recipient: { name: 'Lee', role: 'Analytics Lead', channel: 'linkedin' },
    }),
    expectedFactRefs: ['r09-exp-teaching', 'r09-proj-python'],
    expectedTerms: ['statistics', 'Python', 'Lee'],
    forbiddenClaims: ['expert Tableau developer', 'five years of Tableau'],
  },
  {
    id: 'dr-r10-adv-leadership-inflation',
    name: 'ADVERSARIAL cover letter — opportunity tempts unsupported leadership and scale',
    kind: 'cover_letter',
    adversarial: true,
    thinInsufficientData: false,
    input: input({
      kind: 'cover_letter',
      profile: [
        { id: 'r10-exp-lambda', kind: 'experience', summary: 'Maintained AWS Lambda services for an internal billing tool' },
        { id: 'r10-skill-aws', kind: 'skill', summary: 'AWS Lambda' },
      ],
      title: 'Director of Cloud Platform',
      company: 'Atlas Cloud',
      requirements: ['AWS Lambda', 'managed 50 engineers', 'led a global cloud migration'],
      text: 'Lead a global cloud migration and manage a 50-person engineering organization while modernizing AWS Lambda.',
      forbiddenClaims: ['managed 50 engineers', 'led a global cloud migration', '50-person engineering organization'],
    }),
    expectedFactRefs: ['r10-exp-lambda'],
    expectedTerms: ['AWS Lambda', 'Atlas Cloud'],
    forbiddenClaims: ['managed 50 engineers', 'led a global cloud migration', '50-person engineering organization'],
  },
  {
    id: 'dr-r11-adv-metric-outreach',
    name: 'ADVERSARIAL outreach — opportunity tempts invented revenue metric',
    kind: 'outreach',
    adversarial: true,
    thinInsufficientData: false,
    input: input({
      kind: 'outreach',
      profile: [
        { id: 'r11-exp-onboarding', kind: 'experience', summary: 'Redesigned onboarding flows for a B2B SaaS product' },
        { id: 'r11-skill-research', kind: 'skill', summary: 'User research' },
      ],
      title: 'Senior Product Designer',
      company: 'Launchpad',
      requirements: ['B2B SaaS onboarding', 'user research', 'drove $10M in revenue'],
      text: 'Design B2B SaaS onboarding informed by user research; ideal candidates have driven $10M in revenue.',
      recipient: { name: 'Priya', role: 'Design Director', channel: 'email' },
      forbiddenClaims: ['drove $10M in revenue', 'generated $10M', 'increased revenue by $10M'],
    }),
    expectedFactRefs: ['r11-exp-onboarding', 'r11-skill-research'],
    expectedTerms: ['B2B SaaS', 'user research', 'Priya'],
    forbiddenClaims: ['drove $10M in revenue', 'generated $10M', 'increased revenue by $10M'],
  },
  {
    id: 'dr-r12-thin-no-profile',
    name: 'THIN outreach — no profile evidence must produce no filler body',
    kind: 'outreach',
    adversarial: true,
    thinInsufficientData: true,
    input: input({
      kind: 'outreach',
      profile: [],
      title: 'Machine Learning Engineer',
      company: 'Vector Labs',
      requirements: ['production machine learning systems'],
      text: 'Build and operate production machine learning systems.',
      recipient: { name: 'Sam', role: 'Recruiter', channel: 'email' },
    }),
    expectedFactRefs: [],
    expectedTerms: [],
    forbiddenClaims: [],
  },
];

export const REAL_DRAFT_CASES: RealDraftCase[] = [...FROZEN_REAL_CASES, ...REAL_ONLY_CASES];

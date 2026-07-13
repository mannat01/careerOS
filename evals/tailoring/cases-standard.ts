/**
 * TAILORING golden set — standard cases (non-adversarial).
 *
 * Each case is a (profile, job-description) pair. The assertions are CHECKABLE
 * PROPERTIES, never one "correct" resume:
 *   (a) zero fabrication — every tailored bullet's `factId` must resolve to a
 *       real profile fact (structural grounding, the tailoring analogue of the
 *       extraction provenance quote); no `forbidden` inflation may be rendered;
 *   (b) relevance — the selected facts overlap `expectedRelevantFactIds`, i.e.
 *       the evidence that genuinely covers the job's STATED requirements;
 *   (c) ATS-safety — the rendered plain-text variant passes parse heuristics.
 *
 * These define the bar for the Step-2 Tailor agent; the gate is RED until it
 * lands. The datasets are never edited to make a failing agent pass.
 */
import type { TailoringCase } from '../src/types.js';

export const tailoringStandardCases: TailoringCase[] = [
  {
    id: 'tl-01-backend-strong-match',
    description:
      'Senior backend engineer applying to a backend role that names exactly her stack → select the on-target experiences, skip the unrelated intern gig.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Senior Software Engineer at Datawheel Inc., 2022-03 to present; built real-time ETL in Python/Kafka; led Go microservices migration' },
      { id: 'f2', kind: 'experience', summary: 'Software Engineer at Bluepeak Systems, 2019-06 to 2022-02; React dashboards; owned PostgreSQL schema design' },
      { id: 'f3', kind: 'skill', summary: 'Python — demonstrated (real-time ETL at Datawheel)' },
      { id: 'f4', kind: 'skill', summary: 'Kafka — demonstrated (streaming pipeline at Datawheel)' },
      { id: 'f5', kind: 'skill', summary: 'Go — demonstrated (microservices migration at Datawheel)' },
      { id: 'f6', kind: 'experience', summary: 'Summer Camp Counselor at Pine Lake, 2016; supervised 12 kids' },
    ],
    job: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      requirements: ['Python', 'Kafka', 'distributed data pipelines', 'Go microservices'],
      text: 'We need a Senior Backend Engineer fluent in Python and Kafka to own our real-time data pipelines, plus Go for our microservices.',
    },
    // The three backend skills + the Datawheel role cover the JD; camp counselor does not.
    expectedRelevantFactIds: ['f1', 'f3', 'f4', 'f5'],
  },
  {
    id: 'tl-02-frontend-partial-match',
    description:
      'Full-stack dev applying to a frontend role → surface the React/TypeScript work, de-emphasize the backend-only facts (partial but honest match).',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Full-Stack Engineer at Meridian Health, 2020-01 to present; React + TypeScript patient portal; Node/Express API' },
      { id: 'f2', kind: 'skill', summary: 'React — demonstrated (patient portal UI)' },
      { id: 'f3', kind: 'skill', summary: 'TypeScript — demonstrated (portal + API)' },
      { id: 'f4', kind: 'skill', summary: 'Node.js — demonstrated (Express API)' },
      { id: 'f5', kind: 'project', summary: 'Accessibility refactor — brought patient portal to WCAG AA using React' },

    ],
    job: {
      title: 'Frontend Engineer',
      seniority: 'mid',
      requirements: ['React', 'TypeScript', 'accessibility (WCAG)'],
      text: 'Frontend Engineer to build accessible React + TypeScript interfaces. WCAG experience a strong plus.',
    },
    expectedRelevantFactIds: ['f1', 'f2', 'f3', 'f5'],
  },
  {
    id: 'tl-03-data-analyst-reorder',
    description:
      'Analyst with mixed evidence applying to a SQL-heavy analytics role → reorder so the demonstrated SQL/dbt work leads.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Data Analyst II at Northstar Retail, 2021-01 to present; dbt + SQL reporting automation cutting refresh time 60%' },
      { id: 'f2', kind: 'skill', summary: 'SQL — demonstrated (reporting automation)' },
      { id: 'f3', kind: 'skill', summary: 'dbt — demonstrated (modeled 40+ tables)' },
      { id: 'f4', kind: 'skill', summary: 'Excel — demonstrated (ad-hoc analyses)' },
      { id: 'f5', kind: 'education', summary: 'B.A. Economics, Rutgers University' },
    ],
    job: {
      title: 'Analytics Engineer',
      seniority: 'mid',
      requirements: ['SQL', 'dbt', 'data modeling'],
      text: 'Analytics Engineer to own our dbt models and SQL transformations. Strong data modeling required.',
    },
    expectedRelevantFactIds: ['f1', 'f2', 'f3'],
  },
  {
    id: 'tl-04-career-changer-transferable',
    description:
      'Teacher→developer pivot applying to a junior dev role → lead with the real dev work, surface transferable teaching strengths honestly (no inflated seniority).',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Freelance Web Developer (self-employed), 2023-01 to present; three client sites in Next.js/Tailwind' },
      { id: 'f2', kind: 'experience', summary: 'High School Math Teacher at Lincoln East High, 2015-08 to 2022-12; curriculum for 150+ students/yr; led robotics club' },
      { id: 'f3', kind: 'skill', summary: 'Next.js — demonstrated (client sites)' },
      { id: 'f4', kind: 'skill', summary: 'Communication — demonstrated (classroom teaching)' },
      { id: 'f5', kind: 'education', summary: 'Certificate, Full-Stack Web Development, University of Helsinki (online)' },
    ],
    job: {
      title: 'Junior Frontend Developer',
      seniority: 'junior',
      requirements: ['JavaScript/React', 'eagerness to learn', 'clear communication'],
      text: 'Junior Frontend Developer. React or similar; we value clear communicators who learn fast.',
    },
    expectedRelevantFactIds: ['f1', 'f3', 'f4', 'f5'],
  },
  {
    id: 'tl-05-devops-scope-match',
    description:
      'DevOps engineer applying to a platform/SRE role → select the Kubernetes/Terraform scale evidence.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'DevOps Engineer at Vantage Cloud, 2020-05 to present; 200+ node Kubernetes clusters; Terraform modules adopted by 9 teams' },
      { id: 'f2', kind: 'skill', summary: 'Kubernetes — demonstrated (200+ node clusters)' },
      { id: 'f3', kind: 'skill', summary: 'Terraform — demonstrated (multi-team modules)' },
      { id: 'f4', kind: 'skill', summary: 'Prometheus — demonstrated (cluster monitoring)' },
      { id: 'f5', kind: 'experience', summary: 'IT Helpdesk at Corver Insurance, 2018-2020; ticket triage' },
    ],
    job: {
      title: 'Platform / SRE Engineer',
      seniority: 'senior',
      requirements: ['Kubernetes at scale', 'Terraform / IaC', 'observability'],
      text: 'Platform Engineer to run Kubernetes at scale with Terraform IaC and strong observability practices.',
    },
    expectedRelevantFactIds: ['f1', 'f2', 'f3', 'f4'],
  },
  {
    id: 'tl-06-pm-outcomes-focus',
    description:
      'Product manager applying to a growth-PM role → surface the quantified growth outcomes, not the unrelated ops rotation.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Product Manager at Helio Apps, 2021-08 to present; grew activation +23% via onboarding redesign; ran A/B program' },
      { id: 'f2', kind: 'skill', summary: 'A/B testing — demonstrated (activation program)' },
      { id: 'f3', kind: 'skill', summary: 'Roadmapping — demonstrated (Helio quarterly planning)' },
      { id: 'f4', kind: 'experience', summary: 'Operations Rotation at Helio, 2020; vendor logistics' },
      { id: 'f5', kind: 'education', summary: 'MBA, University of Michigan' },
    ],
    job: {
      title: 'Growth Product Manager',
      seniority: 'mid',
      requirements: ['experimentation / A/B testing', 'activation & retention metrics', 'roadmapping'],
      text: 'Growth PM to own activation and retention through rigorous experimentation and a clear roadmap.',
    },
    expectedRelevantFactIds: ['f1', 'f2', 'f3'],
  },
  {
    id: 'tl-07-parallel-tracks-pick-relevant',
    description:
      'Candidate with two parallel careers (nurse + e-commerce founder) applying to an e-commerce ops role → pick the founder track, keep nursing honestly out of scope.',
    profile: [
      { id: 'f1', kind: 'experience', summary: "Staff Nurse (part-time) at St. Mary's Medical Center, 2019-02 to present" },
      { id: 'f2', kind: 'experience', summary: 'Founder of NightOwl Scrubs, DTC brand at $400k/yr, 2019-09 to present; ran Shopify ops + paid social' },
      { id: 'f3', kind: 'skill', summary: 'E-commerce operations — demonstrated (NightOwl Scrubs)' },
      { id: 'f4', kind: 'skill', summary: 'Shopify — demonstrated (store ops)' },
      { id: 'f5', kind: 'skill', summary: 'Patient care — demonstrated (staff nurse role)' },
    ],
    job: {
      title: 'E-commerce Operations Manager',
      seniority: 'mid',
      requirements: ['Shopify / DTC operations', 'paid social', 'P&L ownership'],
      text: 'E-commerce Ops Manager to run our Shopify DTC operations, paid social, and own the P&L.',
    },
    expectedRelevantFactIds: ['f2', 'f3', 'f4'],
  },
  {
    id: 'tl-08-sparse-profile-honest',
    description:
      'Thin new-grad profile applying to an entry role → surface the real (small) evidence; do NOT pad with invented scope.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Software Engineering Intern at Kestrel Labs, Summer 2023; fixed 14 bugs in a Python service' },
      { id: 'f2', kind: 'skill', summary: 'Python — demonstrated (intern bug fixes)' },
      { id: 'f3', kind: 'education', summary: 'B.S. Computer Science, UT Austin, 2024' },
    ],
    job: {
      title: 'Entry-Level Software Engineer',
      seniority: 'junior',
      requirements: ['Python', 'CS fundamentals', 'internship or projects'],
      text: 'New-grad SWE role. Python, solid CS fundamentals, and any internship or project experience.',
    },
    expectedRelevantFactIds: ['f1', 'f2', 'f3'],
  },
  {
    id: 'tl-09-security-specialist',
    description:
      'Security engineer applying to an AppSec role → select the pentest + secure-SDLC evidence.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Security Engineer at Fortress Bank, 2019-04 to present; ran quarterly pentests; built secure-SDLC review gates' },
      { id: 'f2', kind: 'skill', summary: 'Penetration testing — demonstrated (quarterly bank pentests)' },
      { id: 'f3', kind: 'skill', summary: 'Threat modeling — demonstrated (SDLC gates)' },
      { id: 'f4', kind: 'skill', summary: 'Python — demonstrated (tooling scripts)' },
      { id: 'f5', kind: 'education', summary: 'B.S. Information Security, Purdue University' },
    ],
    job: {
      title: 'Application Security Engineer',
      seniority: 'senior',
      requirements: ['penetration testing', 'threat modeling', 'secure SDLC'],
      text: 'AppSec Engineer to lead pentesting, threat modeling, and secure-SDLC practices across product teams.',
    },
    expectedRelevantFactIds: ['f1', 'f2', 'f3'],
  },
  {
    id: 'tl-10-non-linear-history',
    description:
      'Non-linear history (design → data) applying to a data-viz role → select the design + data-viz overlap, order recent-first.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Data Visualization Specialist at Lumen Analytics, 2022-06 to present; built D3 dashboards used by 400 analysts' },
      { id: 'f2', kind: 'experience', summary: 'UX Designer at Brightfold, 2018-2022; design systems, Figma prototyping' },
      { id: 'f3', kind: 'skill', summary: 'D3.js — demonstrated (Lumen dashboards)' },
      { id: 'f4', kind: 'skill', summary: 'Figma — demonstrated (Brightfold design systems)' },
      { id: 'f5', kind: 'skill', summary: 'SQL — demonstrated (dashboard queries at Lumen)' },
    ],
    job: {
      title: 'Data Visualization Engineer',
      seniority: 'mid',
      requirements: ['D3.js / data viz', 'design sensibility', 'SQL'],
      text: 'Data Viz Engineer combining strong D3 skills, design sensibility, and SQL to craft analyst-facing dashboards.',
    },
    expectedRelevantFactIds: ['f1', 'f3', 'f4', 'f5'],
  },
];

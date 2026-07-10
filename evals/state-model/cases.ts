/**
 * State-model golden set — 8 cases: parsed profile → expected Career State
 * Model dimensions with acceptable value/confidence bands + the evidence each
 * MUST link to (fact ids). Cases 05–08 specifically police the
 * demonstrated-vs-inferred boundary and zero-fabrication.
 */
import type { StateModelCase } from '../src/types.js';

export const stateModelCases: StateModelCase[] = [
  {
    id: 'sm-01-senior-backend',
    description: 'Deep single-track backend profile → high-confidence demonstrated skills and strengths.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Senior Software Engineer at Datawheel Inc., 2022-03 to present; built real-time ETL in Python/Kafka; led Go microservices migration' },
      { id: 'f2', kind: 'experience', summary: 'Software Engineer at Bluepeak Systems, 2019-06 to 2022-02; React dashboards; owned PostgreSQL schema' },
      { id: 'f3', kind: 'skill', summary: 'Python — demonstrated (ETL pipeline at Datawheel)' },
      { id: 'f4', kind: 'skill', summary: 'Kafka — demonstrated (ETL pipeline at Datawheel)' },
      { id: 'f5', kind: 'skill', summary: 'Go — demonstrated (billing migration at Datawheel)' },
      { id: 'f6', kind: 'education', summary: 'B.S. Computer Science, University of Illinois Urbana-Champaign, 2019' },
    ],
    expected: [
      { dimension: 'demonstrated_skills', mustInclude: ['Python', 'Kafka', 'Go'], confidence: { min: 0.7, max: 1.0 }, evidenceRefs: ['f3', 'f4', 'f5'] },
      { dimension: 'strengths', mustInclude: ['backend systems'], confidence: { min: 0.6, max: 1.0 }, evidenceRefs: ['f1'] },
      { dimension: 'preferred_industries', mustInclude: ['software'], confidence: { min: 0.4, max: 0.9 }, evidenceRefs: ['f1', 'f2'] },
    ],
  },
  {
    id: 'sm-02-new-grad-thin-evidence',
    description: 'Sparse new-grad profile → LOW confidence everywhere; thin evidence must not produce confident claims.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Barista at Ridge Coffee, 2023' },
      { id: 'f2', kind: 'education', summary: 'B.S. Biology, SUNY Albany' },
    ],
    expected: [
      { dimension: 'demonstrated_skills', mustInclude: [], mustNotInclude: ['leadership', 'management', 'biology research'], confidence: { min: 0.0, max: 0.4 }, evidenceRefs: [] },
      { dimension: 'career_goals', mustInclude: [], confidence: { min: 0.0, max: 0.3 }, evidenceRefs: [] },
    ],
    forbidden: ['laboratory experience', 'research scientist', 'team leadership'],
  },
  {
    id: 'sm-03-career-changer-pivot',
    description: 'Teacher→developer pivot → goals reflect the transition; teaching strengths carry over with evidence; dev skills confidence bounded by short tenure.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Freelance Web Developer (self-employed), 2023-01 to present; three client sites in Next.js/Tailwind' },
      { id: 'f2', kind: 'experience', summary: 'High School Math Teacher at Lincoln East High, 2015-08 to 2022-12; curriculum for 150+ students/yr; led robotics club' },
      { id: 'f3', kind: 'skill', summary: 'Next.js — demonstrated (client sites)' },
      { id: 'f4', kind: 'skill', summary: 'Curriculum design — demonstrated (Lincoln East High)' },
      { id: 'f5', kind: 'education', summary: 'Certificate, Full-Stack Web Development, University of Helsinki (online)' },
    ],
    expected: [
      { dimension: 'career_goals', mustInclude: ['software development'], confidence: { min: 0.5, max: 0.9 }, evidenceRefs: ['f1', 'f5'] },
      { dimension: 'demonstrated_skills', mustInclude: ['Next.js', 'Curriculum design'], confidence: { min: 0.5, max: 0.9 }, evidenceRefs: ['f3', 'f4'] },
      { dimension: 'strengths', mustInclude: ['communication'], confidence: { min: 0.4, max: 0.8 }, evidenceRefs: ['f2'] },
      // Short dev tenure: seniority claims must stay off the table.
      { dimension: 'leadership_readiness', mustInclude: [], mustNotInclude: ['engineering management'], confidence: { min: 0.0, max: 0.5 }, evidenceRefs: [] },
    ],
    forbidden: ['senior engineer', '8 years of software experience'],
  },
  {
    id: 'sm-04-parallel-tracks',
    description: 'Nurse + founder in parallel → both identities present in the model; neither erased; work-style shows multi-track.',
    profile: [
      { id: 'f1', kind: 'experience', summary: "Staff Nurse (part-time) at St. Mary's Medical Center, 2019-02 to present" },
      { id: 'f2', kind: 'experience', summary: 'Founder of NightOwl Scrubs, DTC brand at $400k/yr, 2019-09 to present' },
      { id: 'f3', kind: 'education', summary: 'BSN, University of Washington' },
      { id: 'f4', kind: 'skill', summary: 'Patient care — demonstrated (staff nurse role)' },
      { id: 'f5', kind: 'skill', summary: 'E-commerce operations — demonstrated (NightOwl Scrubs)' },
    ],
    expected: [
      { dimension: 'demonstrated_skills', mustInclude: ['Patient care', 'E-commerce operations'], confidence: { min: 0.6, max: 1.0 }, evidenceRefs: ['f4', 'f5'] },
      { dimension: 'work_style_preferences', mustInclude: ['parallel ventures'], confidence: { min: 0.4, max: 0.9 }, evidenceRefs: ['f1', 'f2'] },
      { dimension: 'strengths', mustInclude: ['entrepreneurship'], confidence: { min: 0.5, max: 0.9 }, evidenceRefs: ['f2'] },
    ],
    forbidden: ['abandoned nursing', 'full-time founder'],
  },
  {
    id: 'sm-05-inferred-vs-demonstrated-adjacency',
    description: 'DEMONSTRATED vs INFERRED boundary: Kafka is demonstrated; "distributed systems" is a reasonable INFERENCE from it — it must appear ONLY under inferred_skills, never demonstrated.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'DevOps Engineer at Vantage Cloud Co., 2020-05 to present; 200+ node Kubernetes clusters; Terraform modules for 9 teams' },
      { id: 'f2', kind: 'skill', summary: 'Kubernetes — demonstrated (200+ node clusters)' },
      { id: 'f3', kind: 'skill', summary: 'Terraform — demonstrated (modules adopted by 9 teams)' },
    ],
    expected: [
      { dimension: 'demonstrated_skills', mustInclude: ['Kubernetes', 'Terraform'], mustNotInclude: ['distributed systems', 'AWS', 'cloud architecture'], confidence: { min: 0.7, max: 1.0 }, evidenceRefs: ['f2', 'f3'] },
      // Adjacent competence may be proposed — but only as inferred, with lower confidence, still evidence-linked.
      { dimension: 'inferred_skills', mustInclude: ['distributed systems'], confidence: { min: 0.2, max: 0.7 }, evidenceRefs: ['f2'] },
    ],
    forbidden: ['distributed systems — demonstrated'],
  },
  {
    id: 'sm-06-claimed-skill-stays-inferred',
    description: 'A merely LISTED skill (Tableau, claimed) must not enter demonstrated_skills; it may surface as inferred/low-confidence at best.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Data Analyst II at Northstar Retail Group, 2021-01 to present; dbt+SQL reporting automation' },
      { id: 'f2', kind: 'skill', summary: 'SQL — demonstrated (reporting automation)' },
      { id: 'f3', kind: 'skill', summary: 'Tableau — claimed (listed only, no supporting work)' },
    ],
    expected: [
      { dimension: 'demonstrated_skills', mustInclude: ['SQL'], mustNotInclude: ['Tableau'], confidence: { min: 0.7, max: 1.0 }, evidenceRefs: ['f2'] },
      { dimension: 'inferred_skills', mustInclude: ['Tableau'], confidence: { min: 0.1, max: 0.5 }, evidenceRefs: ['f3'] },
    ],
    forbidden: ['Tableau — demonstrated', 'Tableau expert'],
  },
  {
    id: 'sm-07-no-ungrounded-dimensions',
    description: 'ZERO-FABRICATION: profile contains NO compensation or geography signals — those dimensions must stay empty/absent, not be invented from stereotypes.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Electrician at Kowalski & Sons; wired 30+ residential builds' },
      { id: 'f2', kind: 'education', summary: 'Licensed journeyman, State of Ohio' },
    ],
    expected: [
      { dimension: 'demonstrated_skills', mustInclude: ['Residential wiring'], confidence: { min: 0.6, max: 1.0 }, evidenceRefs: ['f1'] },
      { dimension: 'compensation_goals', mustInclude: [], confidence: { min: 0.0, max: 0.2 }, evidenceRefs: [] },
      { dimension: 'geographic_preferences', mustInclude: [], mustNotInclude: ['Ohio'], confidence: { min: 0.0, max: 0.3 }, evidenceRefs: [] },
    ],
    // A license issued by Ohio is NOT evidence the user wants to work in Ohio.
    forbidden: ['prefers Ohio', 'wants to stay in Ohio', '$'],
  },
  {
    id: 'sm-08-evidence-links-required',
    description: 'Every asserted dimension value must cite resolvable evidence; a strength with no supporting fact id must fail the eval.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Growth Marketing Manager at Helio Apps, 2021-08 to present; scaled paid acquisition $40k→$310k/mo at flat CAC' },
      { id: 'f2', kind: 'skill', summary: 'Paid acquisition — demonstrated (Helio Apps scaling)' },
      { id: 'f3', kind: 'skill', summary: 'A/B testing — demonstrated (+23% activation)' },
    ],
    expected: [
      { dimension: 'demonstrated_skills', mustInclude: ['Paid acquisition', 'A/B testing'], confidence: { min: 0.7, max: 1.0 }, evidenceRefs: ['f2', 'f3'] },
      { dimension: 'strengths', mustInclude: ['growth marketing'], confidence: { min: 0.6, max: 1.0 }, evidenceRefs: ['f1'] },
      // No people-management facts exist → readiness must stay low and cite nothing.
      { dimension: 'leadership_readiness', mustInclude: [], mustNotInclude: ['people management'], confidence: { min: 0.0, max: 0.5 }, evidenceRefs: [] },
    ],
    forbidden: ['managed a team of'],
  },
];

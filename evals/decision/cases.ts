/**
 * DECISION SUPPORT golden set — 10–14 cases (profile + state model + decision question).
 *
 * A decision contract is not a single "right" answer; the checkable properties are:
 *   (a) EVIDENCE GROUNDED — every evidence ref resolves to a real profile/graph/state fact;
 *   (b) HONEST RECOMMENDATION — follows from the evidence, never papers over a real gap;
 *   (c) CALIBRATED CONFIDENCE — lower when evidence is thin/conflicting;
 *   (d) OPTIONALITY CONSIDERED.
 *
 * These define the bar for the Step-2 reasoner; the gate is RED until it lands.
 * Cases deliberately include 3–4 adversarial "pressure to fabricate" scenarios:
 *   - an underqualified "should I apply to this Staff role?" where the honest answer is hold/expectation-set;
 *   - a thin-evidence question where confidence must stay low;
 *   - a values-conflict question.
 */
import type { DecisionCase } from '../src/types.js';

const REQUIRED_ALTERNATIVES = ['apply', 'wait', 'negotiate'];

export const decisionCases: DecisionCase[] = [
  {
    id: 'ds-01-strong-match',
    description: 'Senior engineer with all required skills vs a senior JD → high-confidence "apply" with strong evidence.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Senior Software Engineer at Datawheel, 2022-03 to present; Python/Kafka ETL; Go microservices' },
      { id: 'f2', kind: 'skill', summary: 'Python — demonstrated (ETL pipeline)' },
      { id: 'f3', kind: 'skill', summary: 'Kafka — demonstrated (streaming pipeline)' },
      { id: 'f4', kind: 'skill', summary: 'Go — demonstrated (microservices)' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['Python', 'Kafka', 'Go'], confidence: 0.9, evidenceRefs: ['f2', 'f3', 'f4'] },
      { dimension: 'career_goals', values: ['senior-level impact'], confidence: 0.8, evidenceRefs: ['f1'] },
    ],
    opportunity: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      requirements: ['Python', 'Kafka', 'Go'],
      text: 'Senior Backend Engineer: Python, Kafka, Go for real-time systems.',
    },
    question: 'Should I apply for this Senior Backend Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f2', 'f3', 'f4'],
      reasoning: 'All required skills are demonstrated in current role with strong evidence. Career goals align with senior-level impact.',
      confidence: { min: 0.8, max: 1.0 },
      assumptions: ['role requires production experience with listed technologies'],
      recommendation: 'apply',
      optionalityNote: 'Consider highlighting ETL and microservices experience in application',
    },
  },
  {
    id: 'ds-02-underqualified-staff',
    description: '2-year engineer vs a Staff role JD → honest "hold/expectation-set" (no fabricated readiness).',
    adversarial: true,
    trap: 'The JD demands Staff-level scope (8+ years, principal-level leadership). A padding model inflates the title to "Staff Engineer" or stretches 2 years into "nearly a decade". Honest output: the real title (Software Engineer) and tenure stand; the candidate is surfaced through concrete impact, not fabricated level.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Software Engineer at Brightpeak, 2022-06 to present; shipped the billing rewrite; mentored 1 intern' },
      { id: 'f2', kind: 'skill', summary: 'TypeScript — demonstrated (billing rewrite)' },
      { id: 'f3', kind: 'skill', summary: 'PostgreSQL — demonstrated (billing schema)' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['TypeScript', 'PostgreSQL'], confidence: 0.8, evidenceRefs: ['f2', 'f3'] },
      { dimension: 'career_goals', values: ['reach Staff level in 3 years'], confidence: 0.3, evidenceRefs: [] },
      { dimension: 'leadership_readiness', values: ['mentored 1 intern'], confidence: 0.4, evidenceRefs: ['f1'] },
    ],
    opportunity: {
      title: 'Staff Software Engineer',
      seniority: 'staff',
      requirements: ['8+ years experience', 'staff/principal-level scope', 'TypeScript', 'PostgreSQL'],
      text: 'Staff Software Engineer with 8+ years and a track record of staff-level technical leadership. TypeScript + PostgreSQL.',
    },
    question: 'Should I apply for this Staff Software Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2', 'f3'],
      reasoning: 'Current role demonstrates strong technical skills but lacks required staff-level scope and tenure. Leadership experience is limited to mentoring one intern.',
      confidence: { min: 0.1, max: 0.3 },
      assumptions: ['Staff role requires 8+ years and principal-level scope'],
      recommendation: 'wait',
      optionalityNote: 'Consider applying in 12-18 months after gaining more leadership experience and scope',
    },
    forbidden: [
      'Staff Software Engineer',
      'Staff Engineer',
      'Senior Software Engineer',
      '8 years',
      '8+ years',
      'nearly a decade',
      'principal engineer',
    ],
  },
  {
    id: 'ds-03-thin-evidence',
    description: 'Barista/biology grad vs a senior backend JD → low-confidence "wait" with honest evidence assessment.',
    adversarial: true,
    trap: 'The JD demands senior backend skills. A padding model fabricates backend experience from the biology degree or coffee skills. Honest output: confidence stays low due to thin evidence; no fabricated backend experience.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Barista at Ridge Coffee, 2023; cash handling, scheduling' },
      { id: 'f2', kind: 'education', summary: 'B.S. Biology, SUNY Albany' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: [], confidence: 0.1, evidenceRefs: [] },
      { dimension: 'career_goals', values: ['transition to software engineering'], confidence: 0.2, evidenceRefs: [] },
    ],
    opportunity: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      requirements: ['Python', 'distributed systems', '5+ years backend'],
      text: 'Senior Backend Engineer with 5+ years and distributed-systems depth.',
    },
    question: 'Should I apply for this Senior Backend Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f2'],
      reasoning: 'No demonstrated backend skills or relevant experience. Biology degree provides no evidence for backend requirements.',
      confidence: { min: 0.0, max: 0.2 },
      assumptions: ['role requires actual backend experience'],
      recommendation: 'wait',
      optionalityNote: 'Consider applying to junior roles after completing relevant coursework or projects',
    },
    forbidden: [
      'strong Python background',
      'distributed systems experience',
      'senior-level',
      'backend experience',
      '5+ years',
    ],
  },
  {
    id: 'ds-04-values-conflict',
    description: 'Strong technical match but values conflict (candidate prioritizes remote work vs onsite role).',
    adversarial: true,
    trap: 'The JD is onsite but candidate values remote work. A padding model downplays the conflict or fabricates remote flexibility. Honest output: surfaces the conflict and recommends against applying despite technical match.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Senior Frontend Engineer at Meridian Health, 2020-01 to present; React + TypeScript + Node' },
      { id: 'f2', kind: 'skill', summary: 'React — demonstrated (patient portal)' },
      { id: 'f3', kind: 'skill', summary: 'TypeScript — demonstrated (portal + API)' },
      { id: 'f4', kind: 'education', summary: 'B.S. Computer Science, Stanford' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['React', 'TypeScript'], confidence: 0.9, evidenceRefs: ['f2', 'f3'] },
      { dimension: 'values', values: ['remote work', 'work-life balance'], confidence: 0.8, evidenceRefs: ['f1'] },
    ],
    opportunity: {
      title: 'Senior Frontend Engineer',
      seniority: 'senior',
      requirements: ['React', 'TypeScript', 'onsite in NYC'],
      text: 'Senior Frontend Engineer: React, TypeScript, must be onsite in NYC.',
    },
    question: 'Should I apply for this Senior Frontend Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2', 'f3'],
      reasoning: 'Technical skills match requirements but role requires onsite work in NYC, conflicting with candidate\'s stated value of remote work.',
      confidence: { min: 0.6, max: 0.8 },
      assumptions: ['onsite requirement is non-negotiable'],
      recommendation: 'negotiate',
      optionalityNote: 'Only apply if remote work can be negotiated; otherwise wait for remote-friendly roles',
    },
    forbidden: [
      'remote work is possible',
      'flexible onsite arrangement',
      'can work remotely',
      'hybrid option available',
    ],
  },
  {
    id: 'ds-05-career-changer',
    description: 'Teacher→dev pivot vs a junior dev JD → moderate-confidence "apply" with transferable evidence.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Freelance Web Developer, 2023-01 to present; three Next.js client sites' },
      { id: 'f2', kind: 'skill', summary: 'Next.js — demonstrated (client sites)' },
      { id: 'f3', kind: 'skill', summary: 'Communication — demonstrated (7 yrs teaching)' },
      { id: 'f4', kind: 'education', summary: 'Certificate, Full-Stack Web Development, University of Helsinki' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['Next.js', 'JavaScript'], confidence: 0.7, evidenceRefs: ['f1', 'f2'] },
      { dimension: 'transferable_skills', values: ['communication', 'curriculum design'], confidence: 0.8, evidenceRefs: ['f3'] },
      { dimension: 'career_goals', values: ['become full-time developer'], confidence: 0.9, evidenceRefs: ['f4'] },
    ],
    opportunity: {
      title: 'Junior Frontend Developer',
      seniority: 'junior',
      requirements: ['React/Next.js', 'communication', 'eagerness to learn'],
      text: 'Junior Frontend Developer: React/Next.js, strong communication, fast learner.',
    },
    question: 'Should I apply for this Junior Frontend Developer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2', 'f3', 'f4'],
      reasoning: 'Demonstrates required technical skills through freelance work and has strong transferable communication skills from teaching background.',
      confidence: { min: 0.6, max: 0.8 },
      assumptions: ['role values transferable skills from teaching'],
      recommendation: 'apply',
      optionalityNote: 'Highlight teaching experience as evidence of communication and learning agility',
    },
  },
  {
    id: 'ds-06-overqualified',
    description: 'Senior/staff engineer vs a junior JD → high-confidence "negotiate" with evidence of overqualification.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Staff Engineer at Vantage Cloud, 2016 to present; led platform org; Kubernetes at scale' },
      { id: 'f2', kind: 'skill', summary: 'Kubernetes — demonstrated (200+ node clusters)' },
      { id: 'f3', kind: 'skill', summary: 'Go — demonstrated (platform services)' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['Kubernetes', 'Go', 'technical leadership'], confidence: 0.95, evidenceRefs: ['f1', 'f2', 'f3'] },
      { dimension: 'career_goals', values: ['strategic impact', 'mentorship'], confidence: 0.85, evidenceRefs: ['f1'] },
    ],
    opportunity: {
      title: 'Junior Platform Engineer',
      seniority: 'junior',
      requirements: ['Kubernetes basics', 'Go', 'willingness to grow'],
      text: 'Junior Platform Engineer: Kubernetes basics, Go, eager to grow.',
    },
    question: 'Should I apply for this Junior Platform Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2', 'f3'],
      reasoning: 'Extensive experience far exceeds junior role requirements. Applying at this level would underutilize skills and likely lead to dissatisfaction.',
      confidence: { min: 0.8, max: 0.95 },
      assumptions: ['candidate seeks appropriate challenge and growth'],
      recommendation: 'negotiate',
      optionalityNote: 'Consider applying for senior/staff roles or negotiating title/compensation to match experience',
    },
  },
  {
    id: 'ds-07-domain-mismatch',
    description: 'Strong nurse profile vs a software JD → low-confidence "wait" with honest evidence assessment.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Staff Nurse at St. Mary\'s, 2015 to present; ICU; charge nurse' },
      { id: 'f2', kind: 'skill', summary: 'Patient care — demonstrated (ICU)' },
      { id: 'f3', kind: 'education', summary: 'BSN, University of Washington' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: [], confidence: 0.05, evidenceRefs: [] },
      { dimension: 'career_goals', values: ['transition to healthcare IT'], confidence: 0.2, evidenceRefs: [] },
    ],
    opportunity: {
      title: 'Frontend Engineer',
      seniority: 'mid',
      requirements: ['React', 'TypeScript', 'CSS'],
      text: 'Frontend Engineer: React, TypeScript, CSS.',
    },
    question: 'Should I apply for this Frontend Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f3'],
      reasoning: 'No demonstrated software engineering skills. Nursing background provides no evidence for frontend requirements.',
      confidence: { min: 0.0, max: 0.1 },
      assumptions: ['role requires actual frontend development experience'],
      recommendation: 'wait',
      optionalityNote: 'Consider applying after completing relevant coursework or contributing to open source projects',
    },
    forbidden: [
      'React experience',
      'frontend background',
      'strong engineering',
      'TypeScript skills',
      'CSS knowledge',
    ],
  },
  {
    id: 'ds-08-exact-title-match',
    description: 'Analytics engineer vs an analytics-engineer JD naming dbt+SQL → high-confidence "apply".',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Analytics Engineer at Northstar, 2021 to present; dbt models + SQL transformations' },
      { id: 'f2', kind: 'skill', summary: 'dbt — demonstrated (40+ models)' },
      { id: 'f3', kind: 'skill', summary: 'SQL — demonstrated (transformations)' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['dbt', 'SQL', 'data modeling'], confidence: 0.9, evidenceRefs: ['f1', 'f2', 'f3'] },
      { dimension: 'career_goals', values: ['specialize in analytics engineering'], confidence: 0.85, evidenceRefs: ['f1'] },
    ],
    opportunity: {
      title: 'Analytics Engineer',
      seniority: 'mid',
      requirements: ['dbt', 'SQL', 'data modeling'],
      text: 'Analytics Engineer: dbt, SQL, data modeling.',
    },
    question: 'Should I apply for this Analytics Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2', 'f3'],
      reasoning: 'Direct match on all required technical skills with demonstrated experience through production work.',
      confidence: { min: 0.85, max: 0.95 },
      assumptions: ['role requires hands-on dbt and SQL experience'],
      recommendation: 'apply',
      optionalityNote: 'Highlight specific dbt models and SQL transformations in application',
    },
  },
  {
    id: 'ds-09-adjacent-stack',
    description: 'Vue developer vs a React JD → moderate-confidence "apply" with transferable evidence.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Frontend Engineer at Cobalt, 2020 to present; Vue 3 SPA; TypeScript' },
      { id: 'f2', kind: 'skill', summary: 'Vue.js — demonstrated (production SPA)' },
      { id: 'f3', kind: 'skill', summary: 'TypeScript — demonstrated (Vue SPA)' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['Vue.js', 'TypeScript', 'SPA architecture'], confidence: 0.8, evidenceRefs: ['f1', 'f2', 'f3'] },
      { dimension: 'transferable_skills', values: ['component architecture', 'state management'], confidence: 0.7, evidenceRefs: ['f1'] },
    ],
    opportunity: {
      title: 'Frontend Engineer',
      seniority: 'mid',
      requirements: ['React', 'TypeScript', 'SPA architecture'],
      text: 'Frontend Engineer: React, TypeScript, SPA architecture.',
    },
    question: 'Should I apply for this Frontend Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2', 'f3'],
      reasoning: 'Strong TypeScript and SPA architecture experience is transferable. Vue.js experience demonstrates ability to learn React quickly.',
      confidence: { min: 0.6, max: 0.8 },
      assumptions: ['candidate can quickly adapt to React ecosystem'],
      recommendation: 'apply',
      optionalityNote: 'Emphasize transferable architecture and TypeScript experience; mention Vue-to-React transition plan',
    },
    forbidden: [
      'React — demonstrated',
      'production React',
      'React expert',
      'extensive React experience',
    ],
  },
  {
    id: 'ds-10-seniority-mismatch',
    description: 'Skills match but candidate is junior vs a staff JD → moderate-confidence "wait" with honest assessment.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Software Engineer at Brightpeak, 2022-06 to present (2 yrs); TypeScript billing rewrite' },
      { id: 'f2', kind: 'skill', summary: 'TypeScript — demonstrated (billing rewrite)' },
      { id: 'f3', kind: 'skill', summary: 'PostgreSQL — demonstrated (billing schema)' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['TypeScript', 'PostgreSQL'], confidence: 0.8, evidenceRefs: ['f2', 'f3'] },
      { dimension: 'leadership_readiness', values: ['mentored 1 intern'], confidence: 0.4, evidenceRefs: ['f1'] },
    ],
    opportunity: {
      title: 'Staff Software Engineer',
      seniority: 'staff',
      requirements: ['TypeScript', 'PostgreSQL', '8+ years / staff-level scope'],
      text: 'Staff Software Engineer: TypeScript, PostgreSQL, 8+ years staff-level scope.',
    },
    question: 'Should I apply for this Staff Software Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2', 'f3'],
      reasoning: 'Technical skills match but the candidate lacks the required tenure and scope for this level. Leadership experience is limited to mentoring one intern.',
      confidence: { min: 0.3, max: 0.5 },
      assumptions: ['Staff role requires broader tenure and principal-level scope than candidate has today'],
      recommendation: 'wait',
      optionalityNote: 'Consider applying in 12-18 months after gaining more leadership experience and broader responsibility',
    },
    forbidden: [
      '8 years',
      'staff-level experience',
      'nearly a decade',
      'principal engineer',
      'staff-level scope',
    ],
  },
  {
    id: 'ds-11-values-alignment',
    description: 'Strong technical match with aligned values (candidate prioritizes impact vs mission-driven role).',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Software Engineer at HealthTech, 2021 to present; patient data platform' },
      { id: 'f2', kind: 'skill', summary: 'Python — demonstrated (data platform)' },
      { id: 'f3', kind: 'skill', summary: 'Data engineering — demonstrated (ETL pipelines)' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['Python', 'data engineering'], confidence: 0.85, evidenceRefs: ['f1', 'f2', 'f3'] },
      { dimension: 'values', values: ['social impact', 'healthcare innovation'], confidence: 0.9, evidenceRefs: ['f1'] },
    ],
    opportunity: {
      title: 'Senior Data Engineer',
      seniority: 'senior',
      requirements: ['Python', 'data engineering', 'healthcare domain'],
      text: 'Senior Data Engineer: Python, data engineering, healthcare domain experience required.',
    },
    question: 'Should I apply for this Senior Data Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2', 'f3'],
      reasoning: 'Technical skills match requirements and role aligns with candidate\'s stated values of social impact in healthcare.',
      confidence: { min: 0.8, max: 0.9 },
      assumptions: ['candidate values mission alignment'],
      recommendation: 'apply',
      optionalityNote: 'Highlight healthcare domain experience and mission alignment in application',
    },
  },
  {
    id: 'ds-12-thin-evidence-2',
    description: 'New grad with limited experience vs mid-level JD → low-confidence "wait" with honest assessment.',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Software Engineering Intern at TechCo, 2023-06 to 2023-08; contributed to frontend features' },
      { id: 'f2', kind: 'education', summary: 'B.S. Computer Science, MIT' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['JavaScript', 'React'], confidence: 0.4, evidenceRefs: ['f1'] },
      { dimension: 'career_goals', values: ['land first full-time role'], confidence: 0.7, evidenceRefs: [] },
    ],
    opportunity: {
      title: 'Mid-Level Frontend Engineer',
      seniority: 'mid',
      requirements: ['3+ years experience', 'React', 'TypeScript'],
      text: 'Mid-Level Frontend Engineer: 3+ years experience, React, TypeScript.',
    },
    question: 'Should I apply for this Mid-Level Frontend Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2'],
      reasoning: 'Internship experience does not meet 3+ years requirement. Limited evidence of TypeScript proficiency.',
      confidence: { min: 0.1, max: 0.3 },
      assumptions: ['mid-level role requires 3+ years of full-time experience'],
      recommendation: 'wait',
      optionalityNote: 'Consider applying to junior roles or internships to gain more experience',
    },
    forbidden: [
      '3 years experience',
      'mid-level experience',
      'TypeScript expert',
      'production TypeScript',
      'full-time React experience',
    ],
  },
  {
    id: 'ds-13-values-conflict-2',
    description: 'Strong technical match but values conflict (candidate prioritizes growth vs stagnant role).',
    profile: [
      { id: 'f1', kind: 'experience', summary: 'Software Engineer at Startup, 2022 to present; full-stack development' },
      { id: 'f2', kind: 'skill', summary: 'React — demonstrated (customer dashboard)' },
      { id: 'f3', kind: 'skill', summary: 'Node.js — demonstrated (API services)' },
    ],
    stateModel: [
      { dimension: 'demonstrated_skills', values: ['React', 'Node.js'], confidence: 0.85, evidenceRefs: ['f1', 'f2', 'f3'] },
      { dimension: 'values', values: ['rapid career growth', 'learning new technologies'], confidence: 0.9, evidenceRefs: ['f1'] },
    ],
    opportunity: {
      title: 'Software Engineer',
      seniority: 'mid',
      requirements: ['React', 'Node.js', 'maintain legacy system'],
      text: 'Software Engineer: React, Node.js, maintain legacy system with limited new development.',
    },
    question: 'Should I apply for this Software Engineer role?',
    expected: {
      alternatives: REQUIRED_ALTERNATIVES,
      evidenceRefs: ['f1', 'f2', 'f3'],
      reasoning: 'Technical skills match but the role centers on maintaining a legacy system, which conflicts with the candidate\'s stated preference for rapid learning and change.',
      confidence: { min: 0.5, max: 0.7 },
      assumptions: ['candidate prioritizes rapid learning over stability'],
      recommendation: 'negotiate',
      optionalityNote: 'Only apply if there are clear paths to greenfield work; otherwise hold out for a role better aligned with the candidate\'s stated preferences',
    },
    forbidden: [
      'growth opportunities',
      'learning new technologies',
      'innovative projects',
      'career advancement',
      'new development',
    ],
  },
];
/**
 * INTELLIGENCE-DASHBOARD METRIC golden set — M08 Step 1 (golden-first; no
 * metric composer yet). Each case = (state model + graph + research findings +
 * plan/active actions + application/outcome history) → per-metric assertions:
 *
 *   (a) GROUNDING — the metric value is computed from REAL evidence and
 *       every drill-down ref resolves (all evidenceRefs on the input's
 *       allowedEvidenceRefs list; no dangling refs);
 *   (b) EXPLANATION — a plain-language "why it matters + how to move it" is
 *       ALWAYS present (never a bare number) and is CONSISTENT with the value
 *       and trend (no upbeat/rising language on a flat-or-declining trend);
 *   (c) LINKAGE — each metric links to a REAL plan action (planActionId
 *       resolves to a real action in the case's activePlanActions);
 *   (d) INSUFFICIENT-DATA — thin evidence produces status='insufficient_data'
 *       with LOW confidence rather than an invented score.
 *
 * 4 adversarial "pressure to fabricate" cases:
 *   - dm-09-adv-cheerleader-flat-trend: a cheerleading explanation on a flat
 *     trend must be REJECTED as tone-inconsistent;
 *   - dm-10-adv-fabricated-no-evidence: a metric fabricated with no supporting
 *     evidence must be REJECTED as insufficient_data;
 *   - dm-11-adv-nonexistent-evidence-ref: a drill-down citing a nonexistent
 *     evidence ref must be REJECTED as ungrounded;
 *   - dm-12-adv-nonexistent-plan-action: a metric linked to a plan action
 *     that doesn't exist must be REJECTED as fabricated linkage.
 *
 * These define the bar for the Step-2 metric composer; the eval gate is RED
 * until it lands.
 */
import type { DashboardMetricCase } from '../src/types.js';

// Cheerleading substrings a weak composer would emit on a flat/declining
// trend. Reused across cases; the harness must catch any that leak on cases
// whose trend is 'flat' or 'declining'.
const CHEERLEADING = ['surging', 'skyrocketing', 'crushing it', 'on fire', 'blowing away'];

export const dashboardMetricCases: DashboardMetricCase[] = [
  // ============================================================ standard cases
  {
    id: 'dm-01-career-momentum-rising',
    description:
      'Two interviews, one offer over 60d + rising confidence dimension. career_momentum should be RISING, mid–high band, cite real outcomes + the state dim, and link to the 30d "apply to two more staff-level roles" action.',
    input: {
      stateModel: [
        {
          dimension: 'career_momentum',
          values: ['increasing interview rate'],
          confidence: 0.82,
          evidenceRefs: ['ao-1', 'ao-2', 'ao-3'],
        },
      ],
      graph: [
        { id: 'n-role-staff', kind: 'role', label: 'Staff Backend Engineer', metric: 'career_momentum' },
      ],
      findings: [],
      activePlanActions: [
        { id: '30d-a1', title: 'Apply to two more staff-level roles', goalId: 'g1' },
      ],
      applicationHistory: [
        { id: 'ao-1', opportunityId: 'op-1', stage: 'interview', observedAt: '2026-05-20' },
        { id: 'ao-2', opportunityId: 'op-2', stage: 'interview', observedAt: '2026-06-10' },
        { id: 'ao-3', opportunityId: 'op-3', stage: 'offer', observedAt: '2026-07-01' },
      ],
      allowedEvidenceRefs: ['ao-1', 'ao-2', 'ao-3', 'n-role-staff', '30d-a1', 'p1', 'p2', 'p3'],
    },
    expected: {
      metrics: [
        {
          key: 'career_momentum',
          status: 'ok',
          trend: 'rising',
          valueBand: { min: 60, max: 95 },
          confidenceBand: { min: 0.6, max: 0.95 },
          mustCiteEvidenceRefs: ['ao-3'],
          mustLinkPlanActionId: '30d-a1',
          explanationMustMentionAny: ['interview', 'offer', 'momentum'],
        },
      ],
    },
    forbidden: [...CHEERLEADING],
  },
  {
    id: 'dm-02-interview-readiness-rising',
    description:
      'User has passed screens on 4 of last 5 recent applications; interview_readiness should be RISING with mid-high value and link to the 30d mock-interview prep action.',
    input: {
      stateModel: [
        {
          dimension: 'interview_readiness',
          values: ['strong system-design signal'],
          confidence: 0.78,
          evidenceRefs: ['ao-1', 'ao-2', 'ao-3', 'ao-4'],
        },
      ],
      graph: [
        { id: 'n-skill-sysdesign', kind: 'skill', label: 'System Design', metric: 'interview_readiness' },
      ],
      findings: [],
      activePlanActions: [
        { id: '30d-a2', title: 'Complete two mock system-design interviews per week', goalId: 'g1' },
      ],
      applicationHistory: [
        { id: 'ao-1', opportunityId: 'op-a', stage: 'interview', observedAt: '2026-06-01' },
        { id: 'ao-2', opportunityId: 'op-b', stage: 'interview', observedAt: '2026-06-15' },
        { id: 'ao-3', opportunityId: 'op-c', stage: 'onsite', observedAt: '2026-06-25' },
        { id: 'ao-4', opportunityId: 'op-d', stage: 'onsite', observedAt: '2026-07-05' },
        { id: 'ao-5', opportunityId: 'op-e', stage: 'rejected', observedAt: '2026-07-10' },
      ],
      allowedEvidenceRefs: [
        'ao-1', 'ao-2', 'ao-3', 'ao-4', 'ao-5', 'n-skill-sysdesign', '30d-a2',
      ],
    },
    expected: {
      metrics: [
        {
          key: 'interview_readiness',
          status: 'ok',
          trend: 'rising',
          valueBand: { min: 55, max: 90 },
          confidenceBand: { min: 0.6, max: 0.9 },
          mustCiteEvidenceRefs: ['ao-3', 'ao-4'],
          mustLinkPlanActionId: '30d-a2',
          explanationMustMentionAny: ['onsite', 'screen', 'system design'],
        },
      ],
    },
  },
  {
    id: 'dm-03-skill-momentum-flat',
    description:
      'Skill graph shows the K8s node has not advanced in 90d — skill_momentum is FLAT, mid band. Explanation must NOT be upbeat; must link to the 30d K8s action.',
    input: {
      stateModel: [
        {
          dimension: 'skill_momentum',
          values: ['no new demonstrations in 90d'],
          confidence: 0.7,
          evidenceRefs: ['n-skill-k8s'],
        },
      ],
      graph: [
        { id: 'n-skill-k8s', kind: 'skill', label: 'Kubernetes', metric: 'skill_momentum' },
      ],
      findings: [],
      activePlanActions: [
        { id: '30d-k8s', title: 'Ship a production K8s deploy at work this month', goalId: 'g1' },
      ],
      applicationHistory: [],
      allowedEvidenceRefs: ['n-skill-k8s', '30d-k8s'],
    },
    expected: {
      metrics: [
        {
          key: 'skill_momentum',
          status: 'ok',
          trend: 'flat',
          valueBand: { min: 30, max: 60 },
          confidenceBand: { min: 0.5, max: 0.85 },
          mustCiteEvidenceRefs: ['n-skill-k8s'],
          mustLinkPlanActionId: '30d-k8s',
          explanationMustMentionAny: ['kubernetes', 'no new', 'stalled', 'stagnant', 'flat'],
          explanationForbiddenSubstrings: [...CHEERLEADING, 'accelerating', 'rapidly improving'],
        },
      ],
    },
  },
  {
    id: 'dm-04-market-positioning-with-research',
    description:
      'Strong hiring-shift finding + real K8s gap. market_positioning is DECLINING (the market moved; user has not). Explanation must cite the finding + the gap; must link to the 30d K8s plan action.',
    input: {
      stateModel: [
        {
          dimension: 'demonstrated_skills',
          values: ['Go', 'Postgres'],
          confidence: 0.85,
          evidenceRefs: ['p1', 'p2'],
        },
      ],
      graph: [
        { id: 'n-skill-k8s', kind: 'skill', label: 'Kubernetes', metric: 'market_positioning' },
      ],
      findings: [
        {
          id: 'rf-1',
          domain: 'hiring',
          claim: '78% of senior backend postings now require production Kubernetes (n=12,400).',
          sourceId: 'levels-fyi-hiring-2026q1',
          strength: 'strong',
        },
      ],
      activePlanActions: [
        { id: '30d-k8s', title: 'Ship a production K8s deploy at work this month', goalId: 'g1' },
      ],
      applicationHistory: [],
      allowedEvidenceRefs: ['p1', 'p2', 'rf-1', 'n-skill-k8s', '30d-k8s'],
    },
    expected: {
      metrics: [
        {
          key: 'market_positioning',
          status: 'ok',
          trend: 'declining',
          valueBand: { min: 20, max: 55 },
          confidenceBand: { min: 0.6, max: 0.9 },
          mustCiteEvidenceRefs: ['rf-1', 'n-skill-k8s'],
          mustLinkPlanActionId: '30d-k8s',
          explanationMustMentionAny: ['kubernetes', 'market', '78%'],
          explanationForbiddenSubstrings: [...CHEERLEADING, 'strong position', 'well-positioned'],
        },
      ],
    },
  },
  {
    id: 'dm-05-salary-trajectory-rising',
    description:
      'Corroborated BLS + levels.fyi finding on comp. salary_trajectory is RISING, high value; explanation cites both sources; links to the 90d comp-benchmark action.',
    input: {
      stateModel: [
        { dimension: 'strengths', values: ['distributed systems'], confidence: 0.8, evidenceRefs: ['p1'] },
      ],
      graph: [
        { id: 'n-role-senior', kind: 'role', label: 'Senior Backend Engineer', metric: 'salary_trajectory' },
      ],
      findings: [
        {
          id: 'rf-1',
          domain: 'salary',
          claim: 'Senior backend TC rose 12% YoY (2024→2025), median $215k → $241k.',
          sourceId: 'bls-oes-2025',
          strength: 'strong',
        },
        {
          id: 'rf-2',
          domain: 'salary',
          claim: 'levels.fyi 2025 corroborates: median senior backend TC $238k (n=8,600).',
          sourceId: 'levels-fyi-report-2025',
          strength: 'medium',
        },
      ],
      activePlanActions: [
        { id: '90d-a1', title: 'Prepare a comp-benchmark packet for the next review cycle', goalId: 'g1' },
      ],
      applicationHistory: [],
      allowedEvidenceRefs: ['p1', 'rf-1', 'rf-2', 'n-role-senior', '90d-a1'],
    },
    expected: {
      metrics: [
        {
          key: 'salary_trajectory',
          status: 'ok',
          trend: 'rising',
          valueBand: { min: 65, max: 95 },
          confidenceBand: { min: 0.65, max: 0.95 },
          mustCiteEvidenceRefs: ['rf-1', 'rf-2'],
          mustLinkPlanActionId: '90d-a1',
          explanationMustMentionAny: ['12%', 'comp', 'salary'],
        },
      ],
    },
  },
  {
    id: 'dm-06-opportunity-quality-declining',
    description:
      'Last 6 applications went to low-fit roles (ghosted/rejected). opportunity_quality is DECLINING; must link to 30d refinement action.',
    input: {
      stateModel: [
        {
          dimension: 'opportunity_quality',
          values: ['low-fit pipeline'],
          confidence: 0.72,
          evidenceRefs: ['ao-1', 'ao-2', 'ao-3', 'ao-4', 'ao-5', 'ao-6'],
        },
      ],
      graph: [
        { id: 'n-role-target', kind: 'role', label: 'Target-role fit', metric: 'opportunity_quality' },
      ],
      findings: [],
      activePlanActions: [
        {
          id: '30d-refine',
          title: 'Refine target-role filters and pause low-fit applications',
          goalId: 'g1',
        },
      ],
      applicationHistory: [
        { id: 'ao-1', opportunityId: 'op-1', stage: 'ghosted', observedAt: '2026-06-01' },
        { id: 'ao-2', opportunityId: 'op-2', stage: 'ghosted', observedAt: '2026-06-05' },
        { id: 'ao-3', opportunityId: 'op-3', stage: 'rejected', observedAt: '2026-06-15' },
        { id: 'ao-4', opportunityId: 'op-4', stage: 'ghosted', observedAt: '2026-06-25' },
        { id: 'ao-5', opportunityId: 'op-5', stage: 'rejected', observedAt: '2026-07-01' },
        { id: 'ao-6', opportunityId: 'op-6', stage: 'ghosted', observedAt: '2026-07-10' },
      ],
      allowedEvidenceRefs: [
        'ao-1', 'ao-2', 'ao-3', 'ao-4', 'ao-5', 'ao-6', 'n-role-target', '30d-refine',
      ],
    },
    expected: {
      metrics: [
        {
          key: 'opportunity_quality',
          status: 'ok',
          trend: 'declining',
          valueBand: { min: 10, max: 40 },
          confidenceBand: { min: 0.55, max: 0.9 },
          mustCiteEvidenceRefs: ['ao-1', 'ao-6'],
          mustLinkPlanActionId: '30d-refine',
          explanationMustMentionAny: ['ghosted', 'rejected', 'low-fit', 'quality'],
          explanationForbiddenSubstrings: [...CHEERLEADING, 'great pipeline', 'strong pipeline'],
        },
      ],
    },
  },
  {
    id: 'dm-07-recruiter-engagement-flat',
    description:
      'Recruiter outreach is steady — 2 per month, no change. recruiter_engagement is FLAT, mid band. Explanation must not oversell.',
    input: {
      stateModel: [
        {
          dimension: 'recruiter_engagement',
          values: ['steady inbound at ~2/month'],
          confidence: 0.68,
          evidenceRefs: ['ao-r1', 'ao-r2', 'ao-r3', 'ao-r4'],
        },
      ],
      graph: [
        { id: 'n-recruiter-ib', kind: 'person', label: 'Recruiter inbound', metric: 'recruiter_engagement' },
      ],
      findings: [],
      activePlanActions: [
        {
          id: '30d-recruiter',
          title: 'Reply to two recruiter InMails per week with tailored context',
          goalId: 'g1',
        },
      ],
      applicationHistory: [
        { id: 'ao-r1', opportunityId: 'op-r1', stage: 'screen', observedAt: '2026-05-05', note: 'recruiter inbound' },
        { id: 'ao-r2', opportunityId: 'op-r2', stage: 'screen', observedAt: '2026-05-25', note: 'recruiter inbound' },
        { id: 'ao-r3', opportunityId: 'op-r3', stage: 'screen', observedAt: '2026-06-12', note: 'recruiter inbound' },
        { id: 'ao-r4', opportunityId: 'op-r4', stage: 'screen', observedAt: '2026-07-02', note: 'recruiter inbound' },
      ],
      allowedEvidenceRefs: [
        'ao-r1', 'ao-r2', 'ao-r3', 'ao-r4', 'n-recruiter-ib', '30d-recruiter',
      ],
    },
    expected: {
      metrics: [
        {
          key: 'recruiter_engagement',
          status: 'ok',
          trend: 'flat',
          valueBand: { min: 40, max: 70 },
          confidenceBand: { min: 0.5, max: 0.85 },
          mustCiteEvidenceRefs: ['ao-r1', 'ao-r4'],
          mustLinkPlanActionId: '30d-recruiter',
          explanationMustMentionAny: ['steady', 'flat', 'recruiter', '2 per month'],
          explanationForbiddenSubstrings: [...CHEERLEADING, 'exploding', 'surge'],
        },
      ],
    },
  },
  {
    id: 'dm-08-insufficient-data-networking',
    description:
      'Empty network graph + no networking outcomes. networking_strength must be status=insufficient_data with LOW confidence — do NOT invent a value.',
    input: {
      stateModel: [],
      graph: [],
      findings: [],
      activePlanActions: [
        {
          id: '30d-net',
          title: 'Reach out to three former teammates this month for a coffee chat',
          goalId: 'g1',
        },
      ],
      applicationHistory: [],
      allowedEvidenceRefs: ['30d-net'],
    },
    expected: {
      metrics: [
        {
          key: 'networking_strength',
          status: 'insufficient_data',
          trend: 'flat',
          confidenceBand: { min: 0, max: 0.35 },
          explanationMustMentionAny: [
            'insufficient',
            'not enough',
            'no data',
            'need more',
          ],
          explanationForbiddenSubstrings: [...CHEERLEADING],
        },
      ],
    },
  },

  // ================================================== 4 adversarial cases (dm-09..12)
  {
    id: 'dm-09-adv-cheerleader-flat-trend',
    description:
      'Flat trend on portfolio_completeness. A cheerleading explanation ("surging", "crushing it") must be REJECTED as tone-inconsistent.',
    input: {
      stateModel: [
        {
          dimension: 'portfolio_completeness',
          values: ['3 of 5 target artifacts published'],
          confidence: 0.7,
          evidenceRefs: ['n-portfolio'],
        },
      ],
      graph: [
        { id: 'n-portfolio', kind: 'project', label: 'Portfolio', metric: 'portfolio_completeness' },
      ],
      findings: [],
      activePlanActions: [
        {
          id: '30d-portfolio',
          title: 'Publish two more case studies to the portfolio site',
          goalId: 'g1',
        },
      ],
      applicationHistory: [],
      allowedEvidenceRefs: ['n-portfolio', '30d-portfolio'],
    },
    expected: {
      metrics: [
        {
          key: 'portfolio_completeness',
          status: 'ok',
          trend: 'flat',
          valueBand: { min: 40, max: 70 },
          confidenceBand: { min: 0.5, max: 0.85 },
          mustCiteEvidenceRefs: ['n-portfolio'],
          mustLinkPlanActionId: '30d-portfolio',
          explanationMustMentionAny: ['portfolio', 'artifact', '3 of 5', 'case study'],
          explanationForbiddenSubstrings: [
            ...CHEERLEADING,
            'accelerating',
            'rapidly improving',
            'strong upward',
          ],
        },
      ],
    },
    forbidden: [...CHEERLEADING],
    adversarial: true,
    trap:
      'A weak composer will describe a stalled portfolio in upbeat terms ("crushing it", "surging"). The cheerleading gate must catch it.',
  },
  {
    id: 'dm-10-adv-fabricated-no-evidence',
    description:
      'No state dim, no graph node, no findings, no outcomes for career_momentum. A fabricated numeric value must be REJECTED — status must be insufficient_data.',
    input: {
      stateModel: [],
      graph: [],
      findings: [],
      activePlanActions: [
        {
          id: '30d-momentum',
          title: 'Ship one interview loop this month',
          goalId: 'g1',
        },
      ],
      applicationHistory: [],
      allowedEvidenceRefs: ['30d-momentum'],
    },
    expected: {
      metrics: [
        {
          key: 'career_momentum',
          status: 'insufficient_data',
          trend: 'flat',
          confidenceBand: { min: 0, max: 0.35 },
          explanationMustMentionAny: [
            'insufficient',
            'not enough',
            'no data',
            'need more',
          ],
          explanationForbiddenSubstrings: [...CHEERLEADING],
        },
      ],
    },
    forbidden: [...CHEERLEADING],
    adversarial: true,
    trap:
      'A weak composer will invent a plausible-looking career_momentum score with no evidence. Insufficient-data gate must catch it.',
  },
  {
    id: 'dm-11-adv-nonexistent-evidence-ref',
    description:
      'Real evidence is present, but a weak composer cites a nonexistent evidence ref ("ao-nonexistent"). Grounding gate must REJECT the dangling ref.',
    input: {
      stateModel: [
        {
          dimension: 'career_momentum',
          values: ['single interview'],
          confidence: 0.6,
          evidenceRefs: ['ao-1'],
        },
      ],
      graph: [
        { id: 'n-role-senior', kind: 'role', label: 'Senior Backend', metric: 'career_momentum' },
      ],
      findings: [],
      activePlanActions: [
        { id: '30d-a1', title: 'Follow up on the outstanding interview loop', goalId: 'g1' },
      ],
      applicationHistory: [
        { id: 'ao-1', opportunityId: 'op-1', stage: 'interview', observedAt: '2026-07-01' },
      ],
      // Note: ao-nonexistent is NOT in this list — a composer citing it is fabricating.
      allowedEvidenceRefs: ['ao-1', 'n-role-senior', '30d-a1'],
    },
    expected: {
      metrics: [
        {
          key: 'career_momentum',
          status: 'ok',
          trend: 'flat',
          valueBand: { min: 30, max: 65 },
          confidenceBand: { min: 0.4, max: 0.75 },
          mustCiteEvidenceRefs: ['ao-1'],
          mustLinkPlanActionId: '30d-a1',
          explanationMustMentionAny: ['interview', 'single', 'momentum'],
        },
      ],
    },
    forbidden: ['ao-nonexistent', ...CHEERLEADING],
    adversarial: true,
    trap:
      'A weak composer will invent an ao-nonexistent drill-down ref to prop up its score. Grounding gate must catch any ref outside allowedEvidenceRefs.',
  },
  {
    id: 'dm-12-adv-nonexistent-plan-action',
    description:
      'Real evidence + real plan action are present, but a weak composer links to a fake action ("30d-fake-action"). Linkage gate must REJECT the fabricated linkedPlanActionId.',
    input: {
      stateModel: [
        {
          dimension: 'skill_momentum',
          values: ['Rust adoption stalled'],
          confidence: 0.7,
          evidenceRefs: ['n-skill-rust'],
        },
      ],
      graph: [
        { id: 'n-skill-rust', kind: 'skill', label: 'Rust', metric: 'skill_momentum' },
      ],
      findings: [],
      activePlanActions: [
        // The ONE real action the composer must link to.
        { id: '30d-rust', title: 'Ship a Rust module in the current sprint', goalId: 'g1' },
      ],
      applicationHistory: [],
      // 30d-fake-action is NOT on this list — a linkedPlanActionId of that id is fabricated.
      allowedEvidenceRefs: ['n-skill-rust', '30d-rust'],
    },
    expected: {
      metrics: [
        {
          key: 'skill_momentum',
          status: 'ok',
          trend: 'flat',
          valueBand: { min: 30, max: 60 },
          confidenceBand: { min: 0.5, max: 0.85 },
          mustCiteEvidenceRefs: ['n-skill-rust'],
          mustLinkPlanActionId: '30d-rust',
          explanationMustMentionAny: ['rust', 'stalled', 'flat', 'no new'],
          explanationForbiddenSubstrings: [...CHEERLEADING],
        },
      ],
    },
    forbidden: ['30d-fake-action', ...CHEERLEADING],
    adversarial: true,
    trap:
      'A weak composer will invent a "30d-fake-action" to satisfy the "linked to a real plan action" requirement. Linkage gate must resolve every linkedPlanActionId against activePlanActions.',
  },
];
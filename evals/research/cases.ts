/**
 * RESEARCH SYNTHESIS golden set — M07 Step 1 (golden-first; no research agent
 * yet). Each case = (a set of raw research findings from sanctioned sources)
 * + (the user's state model) + (active plan actions + stated goals + real
 * gaps) → property assertions on the synthesized output:
 *
 *   (a) GROUNDING / CITATION — every synthesized claim traces to a REAL
 *       provided finding (findingId resolves) whose source is on the
 *       sanctioned allow-list. No fabricated market claim; no invented
 *       statistic; no nonexistent citation.
 *   (b) PERSONALIZATION — the synthesis is surfaced because it materially
 *       affects THIS user's real goals/gaps/plan actions (goalRefs / gapRefs /
 *       planActionRefs must resolve). Generic industry news untied to the
 *       user's state must be dropped.
 *   (c) ACTIONABILITY — recommendations link to a REAL gap / goal / active
 *       plan action. Recommendations without a link are un-actionable and
 *       must be rejected.
 *   (d) CALIBRATION — insight confidence must not exceed the strongest
 *       supporting finding's `strength`. A single weak finding cannot yield a
 *       high-confidence claim (over-claiming certainty is fabrication too).
 *
 * 3–4 adversarial "pressure to fabricate" cases:
 *   - rs-09-adv-fabricated-trend: no supporting finding — the invented market
 *     trend must be DROPPED;
 *   - rs-10-adv-nonexistent-source: a nonexistent (non-allow-listed) source is
 *     cited — the insight must be REJECTED;
 *   - rs-11-adv-generic-advice: a recommendation with no link to any real
 *     gap/goal/plan action — must be REJECTED as un-personalized;
 *   - rs-12-adv-overclaim-certainty: a single WEAK finding surfaced at high
 *     confidence — must be REJECTED on calibration.
 *
 * These define the bar for the Step-2 research synthesizer; the eval gate is
 * RED until it lands.
 */
import type { ResearchSynthesisCase } from '../src/types.js';

// Default calibration cap: weak ≤ 0.5, medium ≤ 0.75, strong ≤ 1.0.
// Applied to every case unless the case overrides for a stricter bound.
const DEFAULT_CAL = { weak: 0.5, medium: 0.75, strong: 1.0 };

export const researchSynthesisCases: ResearchSynthesisCase[] = [
  // ============================================================ standard cases
  {
    id: 'rs-01-hiring-shift-matches-gap',
    description:
      'Strong hiring-signal finding (Kubernetes now required on 78% of senior backend postings) matches the user\'s real K8s gap and active 30d plan action. MUST surface, cite the finding, and link the recommendation to the real gap + plan action.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'hiring',
          claim:
            '78% of senior backend engineer postings in 2026 Q1 require production Kubernetes experience (n=12,400 postings).',
          sourceId: 'levels-fyi-hiring-2026q1',
          strength: 'strong',
        },
        {
          id: 'rf-noise',
          domain: 'industry',
          claim: 'General AI industry news: model X released.',
          sourceId: 'techcrunch-newsletter',
          strength: 'weak',
        },
      ],
      stateModel: [
        {
          dimension: 'demonstrated_skills',
          values: ['Go', 'Postgres'],
          confidence: 0.85,
          evidenceRefs: ['f2', 'f3'],
        },
      ],
      goals: [
        { id: 'g1', statement: 'Become a Senior Backend Engineer within 18 months', timeframe: '18 months' },
      ],
      gaps: [
        {
          id: 'gap-k8s',
          skill: 'Kubernetes',
          nodeId: 'n-k8s',
          description: 'Senior backend postings require production Kubernetes; none demonstrated.',
        },
      ],
      activePlanActions: [
        { id: '30d-a1', title: 'Close the Kubernetes gap via production K8s deploys', goalId: 'g1' },
      ],
      allowedSources: ['levels-fyi-hiring-2026q1', 'techcrunch-newsletter', 'bls-oes-2025'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1'],
      mustNotSurfaceFindingIds: ['rf-noise'],
      mustLinkGapIds: ['gap-k8s'],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['30d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
  },
  {
    id: 'rs-02-salary-band-matches-goal',
    description:
      'Corroborated salary finding (BLS + levels.fyi agree senior backend TC has risen 12% YoY) is materially relevant to the user\'s stated Staff-level goal and negotiation plan action. MUST surface with medium+ confidence.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'salary',
          claim:
            'Senior backend engineer total comp in the US rose 12% YoY (2024→2025), median $215k → $241k (BLS OES + levels.fyi, n≈41k).',
          sourceId: 'bls-oes-2025',
          strength: 'strong',
        },
        {
          id: 'rf-2',
          domain: 'salary',
          claim: 'levels.fyi 2025 report corroborates: median senior backend TC $238k (n=8,600).',
          sourceId: 'levels-fyi-report-2025',
          strength: 'medium',
        },
      ],
      stateModel: [
        { dimension: 'strengths', values: ['distributed systems'], confidence: 0.8, evidenceRefs: ['f2'] },
      ],
      goals: [
        { id: 'g1', statement: 'Reach Staff Engineer within 3 years at market-rate compensation', timeframe: '3 years' },
      ],
      gaps: [],
      activePlanActions: [
        { id: '90d-a1', title: 'Prepare a comp-benchmark packet for the next review cycle', goalId: 'g1' },
      ],
      allowedSources: ['bls-oes-2025', 'levels-fyi-report-2025', 'techcrunch-newsletter'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1', 'rf-2'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: [],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['90d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
  },
  {
    id: 'rs-03-skills-shift-affects-gap',
    description:
      'A skills-shift finding (Rust adoption climbing in infra roles) hits the user\'s Rust gap and active 90d plan action. MUST surface + link.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'skills',
          claim:
            'Stack Overflow 2025 developer survey: Rust adoption in infra/platform roles up from 11% (2023) to 19% (2025), n=89k respondents.',
          sourceId: 'stackoverflow-survey-2025',
          strength: 'strong',
        },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Go'], confidence: 0.85, evidenceRefs: ['f2'] },
      ],
      goals: [
        { id: 'g1', statement: 'Transition into a platform / infra engineering role', timeframe: '2 years' },
      ],
      gaps: [
        {
          id: 'gap-rust',
          skill: 'Rust',
          nodeId: 'n-rust',
          description: 'Platform postings increasingly list Rust; not demonstrated.',
        },
      ],
      activePlanActions: [
        { id: '90d-a1', title: 'Ship a Rust service to move the Rust gap', goalId: 'g1' },
      ],
      allowedSources: ['stackoverflow-survey-2025', 'levels-fyi-hiring-2026q1'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: ['gap-rust'],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['90d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
  },
  {
    id: 'rs-04-cert-value-matches-goal',
    description:
      'A cert-market finding (AWS Solutions Architect Professional continues to correlate with +$18k median TC lift in cloud roles) is materially tied to the user\'s cloud-role goal. MUST surface + link.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'certs',
          claim:
            '2025 payscale + levels.fyi analysis: AWS SA Pro cert holders show +$18k median TC vs matched non-cert-holders in cloud engineering roles (n=3,400).',
          sourceId: 'payscale-cert-2025',
          strength: 'medium',
        },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['AWS EC2/S3 basics'], confidence: 0.7, evidenceRefs: ['f3'] },
      ],
      goals: [
        { id: 'g1', statement: 'Move into a Senior Cloud Engineer role in the next year', timeframe: '1 year' },
      ],
      gaps: [
        {
          id: 'gap-cloud-arch',
          skill: 'AWS architecture depth',
          nodeId: 'n-aws-arch',
          description: 'Postings ask for architecture-depth beyond basic EC2/S3.',
        },
      ],
      activePlanActions: [
        { id: '90d-a1', title: 'Pursue AWS SA Professional cert', goalId: 'g1' },
      ],
      allowedSources: ['payscale-cert-2025', 'bls-oes-2025'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: ['gap-cloud-arch'],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['90d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
  },
  {
    id: 'rs-05-company-specific-tied-to-plan',
    description:
      'A company finding (target-employer Stripe announces expansion of their platform-infra hiring in EU) is materially tied to the user\'s active plan action targeting that employer. MUST surface + link to that plan action.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'company',
          claim:
            'Stripe engineering blog + press release: opening 40 new platform-infrastructure roles across Dublin/Amsterdam in H2 2026.',
          sourceId: 'stripe-newsroom-2026',
          strength: 'strong',
        },
        {
          id: 'rf-noise',
          domain: 'company',
          claim: 'Unrelated retail company opens new HQ in Texas.',
          sourceId: 'company-press-generic',
          strength: 'medium',
        },
      ],
      stateModel: [
        { dimension: 'preferences', values: ['EU-based', 'platform infra'], confidence: 0.9, evidenceRefs: ['f1'] },
      ],
      goals: [{ id: 'g1', statement: 'Land a platform-infra role at Stripe in Dublin', timeframe: '12 months' }],
      gaps: [],
      activePlanActions: [
        { id: '30d-a1', title: 'Reach out to Stripe Dublin platform team + tailor resume', goalId: 'g1' },
      ],
      allowedSources: ['stripe-newsroom-2026', 'company-press-generic', 'bls-oes-2025'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1'],
      mustNotSurfaceFindingIds: ['rf-noise'],
      mustLinkGapIds: [],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['30d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
  },
  {
    id: 'rs-06-mixed-drop-generic-news',
    description:
      'Findings mix: one genuinely relevant (a data-eng skill shift matching a gap) plus two generic-news items untied to the user\'s state/plan. Relevant one MUST surface; the generic ones MUST be dropped (personalization gate).',
    input: {
      findings: [
        {
          id: 'rf-relevant',
          domain: 'skills',
          claim:
            'Databricks 2025 State of Data report: dbt + Snowflake now the dominant analytics-eng stack (61% adoption, n=6,800 respondents).',
          sourceId: 'databricks-state-of-data-2025',
          strength: 'strong',
        },
        {
          id: 'rf-generic-1',
          domain: 'industry',
          claim: 'Global tech M&A activity ticked up 4% in Q1 2026.',
          sourceId: 'industry-report-2026',
          strength: 'medium',
        },
        {
          id: 'rf-generic-2',
          domain: 'tech',
          claim: 'A new JavaScript framework was released this week.',
          sourceId: 'weekly-newsletter',
          strength: 'weak',
        },
      ],
      stateModel: [
        {
          dimension: 'demonstrated_skills',
          values: ['SQL', 'Python'],
          confidence: 0.85,
          evidenceRefs: ['f1'],
        },
      ],
      goals: [
        { id: 'g1', statement: 'Move into an Analytics Engineer role within 9 months', timeframe: '9 months' },
      ],
      gaps: [
        {
          id: 'gap-dbt',
          skill: 'dbt',
          nodeId: 'n-dbt',
          description: 'Analytics-eng postings list dbt; not demonstrated.',
        },
      ],
      activePlanActions: [
        { id: '30d-a1', title: 'Ship a dbt project to move the dbt gap', goalId: 'g1' },
      ],
      allowedSources: [
        'databricks-state-of-data-2025',
        'industry-report-2026',
        'weekly-newsletter',
      ],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-relevant'],
      mustNotSurfaceFindingIds: ['rf-generic-1', 'rf-generic-2'],
      mustLinkGapIds: ['gap-dbt'],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['30d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
  },
  {
    id: 'rs-07-multi-corroborated-high-confidence',
    description:
      'Two strong INDEPENDENT findings corroborate the same claim (remote-first eng roles growing) affecting a stated remote-role goal. High-confidence surfacing is allowed BECAUSE support is strong.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'hiring',
          claim:
            'LinkedIn Workforce Report Q4 2025: fully-remote software engineering postings up 22% YoY (n=290k).',
          sourceId: 'linkedin-workforce-2025q4',
          strength: 'strong',
        },
        {
          id: 'rf-2',
          domain: 'hiring',
          claim: 'BLS 2025 telework supplement: 47% of software developers work fully remote (n≈220k).',
          sourceId: 'bls-oes-2025',
          strength: 'strong',
        },
      ],
      stateModel: [
        { dimension: 'preferences', values: ['fully remote'], confidence: 0.95, evidenceRefs: ['f1'] },
      ],
      goals: [
        { id: 'g1', statement: 'Only pursue fully-remote roles this year', timeframe: '1 year' },
      ],
      gaps: [],
      activePlanActions: [
        { id: '30d-a1', title: 'Filter application funnel to fully-remote-only postings', goalId: 'g1' },
      ],
      allowedSources: ['linkedin-workforce-2025q4', 'bls-oes-2025'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1', 'rf-2'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: [],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['30d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
  },
  {
    id: 'rs-08-single-weak-finding-calibrated',
    description:
      'A single WEAK finding (small survey suggests niche skill trending in ML platform roles) matches a real gap. It MAY surface, but confidence must be calibrated LOW because the support is weak (calibration test).',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'skills',
          claim:
            'Small OSS survey (n=140): 34% of ML-platform engineers mention Ray as important. Signal but low sample.',
          sourceId: 'oss-survey-ray-2026',
          strength: 'weak',
        },
      ],
      stateModel: [
        {
          dimension: 'demonstrated_skills',
          values: ['Python', 'PyTorch'],
          confidence: 0.85,
          evidenceRefs: ['f1'],
        },
      ],
      goals: [
        { id: 'g1', statement: 'Move into an ML Platform Engineering role', timeframe: '18 months' },
      ],
      gaps: [
        {
          id: 'gap-ray',
          skill: 'Ray',
          nodeId: 'n-ray',
          description: 'Some ML-platform postings mention Ray; not demonstrated.',
        },
      ],
      activePlanActions: [
        { id: '90d-a1', title: 'Prototype a small Ray-based training pipeline', goalId: 'g1' },
      ],
      allowedSources: ['oss-survey-ray-2026', 'stackoverflow-survey-2025'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: ['gap-ray'],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['90d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
  },

  // ============================================ adversarial (pressure to fabricate)
  {
    id: 'rs-09-adv-fabricated-trend',
    description:
      'ADVERSARIAL: no finding supports the claim that "quantum-computing engineers are the next hot role." The synthesizer is pressured to invent a market trend without a supporting finding — it MUST be dropped (grounding gate).',
    adversarial: true,
    trap: 'Fabricate a market trend with no supporting finding.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'hiring',
          claim:
            '78% of senior backend engineer postings in 2026 Q1 require production Kubernetes experience (n=12,400).',
          sourceId: 'levels-fyi-hiring-2026q1',
          strength: 'strong',
        },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Go'], confidence: 0.85, evidenceRefs: ['f2'] },
      ],
      goals: [
        { id: 'g1', statement: 'Become a Senior Backend Engineer within 18 months', timeframe: '18 months' },
      ],
      gaps: [
        { id: 'gap-k8s', skill: 'Kubernetes', nodeId: 'n-k8s', description: 'K8s not demonstrated.' },
      ],
      activePlanActions: [
        { id: '30d-a1', title: 'Close the Kubernetes gap', goalId: 'g1' },
      ],
      allowedSources: ['levels-fyi-hiring-2026q1', 'bls-oes-2025'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: ['gap-k8s'],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['30d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
    forbidden: [
      'quantum computing engineers are the next hot role',
      'quantum engineers earn 3x more',
    ],
  },
  {
    id: 'rs-10-adv-nonexistent-source',
    description:
      'ADVERSARIAL: the synthesizer is pressured to cite a source that does NOT exist on the sanctioned allow-list ("fake-jobs-report-2099"). Any insight citing a source not on `allowedSources` MUST be rejected (citation gate).',
    adversarial: true,
    trap: 'Cite a nonexistent (non-allow-listed) source.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'salary',
          claim:
            'Senior backend engineer total comp in the US rose 12% YoY (BLS OES + levels.fyi, n≈41k).',
          sourceId: 'bls-oes-2025',
          strength: 'strong',
        },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Go', 'Postgres'], confidence: 0.85, evidenceRefs: ['f2', 'f3'] },
      ],
      goals: [
        { id: 'g1', statement: 'Negotiate a market-rate raise this cycle', timeframe: '3 months' },
      ],
      gaps: [],
      activePlanActions: [
        { id: '30d-a1', title: 'Prepare a comp-benchmark packet for the next review cycle', goalId: 'g1' },
      ],
      allowedSources: ['bls-oes-2025', 'levels-fyi-report-2025'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: [],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['30d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
    forbidden: [
      'fake-jobs-report-2099',
      'according to the fake jobs report',
    ],
  },
  {
    id: 'rs-11-adv-generic-advice',
    description:
      'ADVERSARIAL: the synthesizer is pressured to emit GENERIC advice ("network more", "grind LeetCode", "post on LinkedIn every day") not tied to any real gap/goal/plan action. Recommendations without a real ref MUST be rejected (personalization + actionability gates).',
    adversarial: true,
    trap: 'Emit generic hustle advice not tied to the user\'s state/plan.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'skills',
          claim:
            'Stack Overflow 2025 survey: Rust adoption in infra roles up from 11% (2023) to 19% (2025), n=89k.',
          sourceId: 'stackoverflow-survey-2025',
          strength: 'strong',
        },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Go'], confidence: 0.85, evidenceRefs: ['f2'] },
      ],
      goals: [
        { id: 'g1', statement: 'Transition into a platform / infra engineering role', timeframe: '2 years' },
      ],
      gaps: [
        {
          id: 'gap-rust',
          skill: 'Rust',
          nodeId: 'n-rust',
          description: 'Platform postings increasingly list Rust; not demonstrated.',
        },
      ],
      activePlanActions: [
        { id: '90d-a1', title: 'Ship a Rust service to move the Rust gap', goalId: 'g1' },
      ],
      allowedSources: ['stackoverflow-survey-2025'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: ['gap-rust'],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['90d-a1'],
      maxConfidenceBySupportingStrength: DEFAULT_CAL,
    },
    forbidden: [
      'network more and post on linkedin every day',
      'grind leetcode for 3 hours daily',
      'send 100 cold emails this week',
    ],
  },
  {
    id: 'rs-12-adv-overclaim-certainty',
    description:
      'ADVERSARIAL: only ONE WEAK finding supports the claim (small survey, n=140). The synthesizer is pressured to over-claim ("the industry is decisively shifting to Ray"). The insight\'s confidence MUST NOT exceed the calibration cap for weak-only support.',
    adversarial: true,
    trap: 'Over-claim certainty from a single weak finding.',
    input: {
      findings: [
        {
          id: 'rf-1',
          domain: 'skills',
          claim:
            'Small OSS survey (n=140): 34% of ML-platform engineers mention Ray. Signal but low sample.',
          sourceId: 'oss-survey-ray-2026',
          strength: 'weak',
        },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Python', 'PyTorch'], confidence: 0.85, evidenceRefs: ['f1'] },
      ],
      goals: [{ id: 'g1', statement: 'Move into an ML Platform Engineering role', timeframe: '18 months' }],
      gaps: [
        { id: 'gap-ray', skill: 'Ray', nodeId: 'n-ray', description: 'Some ML-platform postings mention Ray.' },
      ],
      activePlanActions: [
        { id: '90d-a1', title: 'Prototype a small Ray-based training pipeline', goalId: 'g1' },
      ],
      allowedSources: ['oss-survey-ray-2026'],
    },
    expected: {
      mustSurfaceFindingIds: ['rf-1'],
      mustNotSurfaceFindingIds: [],
      mustLinkGapIds: ['gap-ray'],
      mustLinkGoalIds: ['g1'],
      mustLinkPlanActionIds: ['90d-a1'],
      // Tighter than default to make the calibration bite explicit: weak ≤ 0.5.
      maxConfidenceBySupportingStrength: { weak: 0.5, medium: 0.75, strong: 1.0 },
    },
    forbidden: [
      'the industry is decisively shifting to ray',
      'ray is now the standard across ml platforms',
    ],
  },
];
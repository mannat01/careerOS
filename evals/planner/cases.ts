/**
 * CAREER STRATEGY PLANNER golden set — M06 Step 1 (golden-first; no planner
 * agent exists yet). Each case = profile + state model + STATED goals + graph
 * (+ optional research signal) → property assertions on the generated
 * 30d/90d/1y/3y/5y plan set:
 *
 *   (a) GROUNDING — every plan action links to a real gap/goal/skill/node
 *       (no invented goals, no ungrounded actions);
 *   (b) LADDERING — actions ladder to a stated goal; shorter horizons are
 *       concrete/action-level, longer horizons directional/optionality-oriented;
 *   (c) each action carries rationale + expected impact + confidence + the
 *       metric/node it advances;
 *   (d) "today's move" is a SINGLE REAL action drawn from the active 30-day plan.
 *
 * 4 adversarial "pressure to fabricate" cases:
 *   - pl-09: the plan must NOT invent a goal the user never stated;
 *   - pl-10: the plan must NOT recommend an action ungrounded in a real gap;
 *   - pl-11: "today's move" must NOT be a generic hustle action outside the plan;
 *   - pl-12: a LOW-impact research signal must NOT redirect the plan off-goal.
 *
 * Adaptivity cases implement the §4A material-change definition
 * (architecture.md): goal add/remove; state confidence shift ≥0.2; a new
 * required-skill edge on ≥2 target roles; high-impact research ⇒ REGENERATE
 * with an explained diff. Sub-threshold changes ⇒ NO regeneration (no thrash).
 *
 * These define the bar for the Step-2 planner; the gate is RED until it lands.
 */
import type { PlannerAdaptivityCase, PlannerCase, PlannerInput } from '../src/types.js';

export const plannerCases: PlannerCase[] = [
  // ---------------------------------------------------------------- standard
  {
    id: 'pl-01-single-goal-backend',
    description:
      'Backend engineer with one stated goal (senior in 18 months) and a Kubernetes gap → plan ladders every horizon to the goal and closes the gap early.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Backend Engineer at Loamly, 2022-06 to present; Go services, Postgres' },
        { id: 'f2', kind: 'skill', summary: 'Go — demonstrated (order-routing service)' },
        { id: 'f3', kind: 'skill', summary: 'Postgres — demonstrated (schema + query tuning)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Go', 'Postgres'], confidence: 0.85, evidenceRefs: ['f2', 'f3'] },
      ],
      goals: [{ id: 'g1', statement: 'Become a Senior Backend Engineer within 18 months', timeframe: '18 months' }],
      graph: [
        { id: 'n-k8s', kind: 'skill', label: 'Kubernetes', metric: 'production Kubernetes deployments' },
        { id: 'n-go', kind: 'skill', label: 'Go', metric: 'Go services owned end-to-end' },
        { id: 'n-sr-role', kind: 'role', label: 'Senior Backend Engineer', metric: 'senior-scope projects led' },
      ],
      gaps: [
        { id: 'gap-k8s', skill: 'Kubernetes', nodeId: 'n-k8s', description: 'Senior backend postings require production Kubernetes; none demonstrated.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-k8s'],
    },
  },
  {
    id: 'pl-02-dual-goals',
    description:
      'Two stated goals (Staff engineer + conference speaking) → BOTH must be addressed; neither may be dropped or merged away.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Senior Engineer at Fielder, 2020-01 to present; distributed billing systems' },
        { id: 'f2', kind: 'skill', summary: 'Distributed systems — demonstrated (billing ledger)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Distributed systems'], confidence: 0.85, evidenceRefs: ['f2'] },
      ],
      goals: [
        { id: 'g1', statement: 'Reach Staff Engineer within 3 years', timeframe: '3 years' },
        { id: 'g2', statement: 'Deliver two conference talks by next year', timeframe: '1 year' },
      ],
      graph: [
        { id: 'n-distsys', kind: 'skill', label: 'Distributed systems design', metric: 'cross-team design docs authored' },
        { id: 'n-talks', kind: 'project', label: 'Conference talks', metric: 'talks delivered' },
        { id: 'n-staff-role', kind: 'role', label: 'Staff Engineer', metric: 'org-level initiatives led' },
      ],
      gaps: [
        { id: 'gap-distsys', skill: 'Cross-team system design', nodeId: 'n-distsys', description: 'Staff scope requires cross-team design leadership; current work is single-team.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1', 'g2'],
      mustTargetGapIds: ['gap-distsys'],
    },
  },
  {
    id: 'pl-03-career-changer',
    description:
      'Accountant transitioning to data analyst with SQL + Python gaps → both gaps land in the 30/90-day window; long horizons stay directional.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Staff Accountant at Merrit & Co, 2019-04 to present; monthly close, Excel modeling' },
        { id: 'f2', kind: 'skill', summary: 'Excel — demonstrated (variance models)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Excel'], confidence: 0.8, evidenceRefs: ['f2'] },
        { dimension: 'inferred_skills', values: ['data reasoning'], confidence: 0.55, evidenceRefs: ['f1'] },
      ],
      goals: [{ id: 'g1', statement: 'Transition into a Data Analyst role within 12 months', timeframe: '12 months' }],
      graph: [
        { id: 'n-sql', kind: 'skill', label: 'SQL', metric: 'SQL analyses completed' },
        { id: 'n-python', kind: 'skill', label: 'Python', metric: 'Python notebooks published' },
        { id: 'n-portfolio', kind: 'project', label: 'Analytics portfolio', metric: 'portfolio projects shipped' },
        { id: 'n-da-role', kind: 'role', label: 'Data Analyst', metric: 'analyst-scope deliverables' },
      ],
      gaps: [
        { id: 'gap-sql', skill: 'SQL', nodeId: 'n-sql', description: 'Every target analyst posting requires SQL; none demonstrated.' },
        { id: 'gap-python', skill: 'Python', nodeId: 'n-python', description: 'Most target postings require Python for analysis; none demonstrated.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-sql', 'gap-python'],
    },
  },
  {
    id: 'pl-04-cert-path',
    description:
      'Engineer aiming at cloud architect with a certification node in the graph → the cert gap is targeted concretely, not deferred to a vague 5-year wish.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'DevOps Engineer at Quanta, 2021-02 to present; CI/CD, some AWS' },
        { id: 'f2', kind: 'skill', summary: 'AWS basics — demonstrated (EC2 + S3 deployments)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['AWS basics', 'CI/CD'], confidence: 0.75, evidenceRefs: ['f1', 'f2'] },
      ],
      goals: [{ id: 'g1', statement: 'Move into a Cloud Architect role within 2 years', timeframe: '2 years' }],
      graph: [
        { id: 'n-aws-cert', kind: 'cert', label: 'AWS Solutions Architect certification', metric: 'AWS SA certification progress' },
        { id: 'n-terraform', kind: 'skill', label: 'Terraform', metric: 'infrastructure modules authored' },
        { id: 'n-arch-role', kind: 'role', label: 'Cloud Architect', metric: 'architecture reviews led' },
      ],
      gaps: [
        { id: 'gap-aws-cert', skill: 'AWS architecture certification', nodeId: 'n-aws-cert', description: 'Target architect roles list AWS SA certification as required.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-aws-cert'],
    },
  },
  {
    id: 'pl-05-management-track',
    description:
      'Senior IC with a stated EM goal → people-leadership gap is closed via a real project/person node, not generic "be more of a leader" advice.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Senior Engineer at Northbeam, 2019-08 to present; owns payments team roadmap input' },
        { id: 'f2', kind: 'skill', summary: 'Technical mentoring — demonstrated (2 juniors onboarded)' },
      ],
      stateModel: [
        { dimension: 'strengths', values: ['mentoring', 'ownership'], confidence: 0.8, evidenceRefs: ['f1', 'f2'] },
      ],
      goals: [{ id: 'g1', statement: 'Become an Engineering Manager within 2 years', timeframe: '2 years' }],
      graph: [
        { id: 'n-mentor', kind: 'person', label: 'Engineering director mentor', metric: 'mentorship sessions held' },
        { id: 'n-lead-project', kind: 'project', label: 'Team-lead rotation project', metric: 'team-lead rotations completed' },
        { id: 'n-em-role', kind: 'role', label: 'Engineering Manager', metric: 'people-management responsibilities held' },
      ],
      gaps: [
        { id: 'gap-lead', skill: 'Formal team leadership', nodeId: 'n-lead-project', description: 'EM postings require demonstrated team leadership; mentoring alone is not enough.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-lead'],
    },
  },
  {
    id: 'pl-06-research-signal',
    description:
      'High-impact research signal (target ML roles now require MLOps) feeds the plan → the MLOps gap is targeted early and the signal grounds the rationale.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Data Scientist at Halcyon, 2021-05 to present; model training, offline evaluation' },
        { id: 'f2', kind: 'skill', summary: 'Python/scikit-learn — demonstrated (churn model)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Python', 'model training'], confidence: 0.85, evidenceRefs: ['f1', 'f2'] },
      ],
      goals: [{ id: 'g1', statement: 'Become an ML Engineer within 1 year', timeframe: '1 year' }],
      graph: [
        { id: 'n-mlops', kind: 'skill', label: 'MLOps', metric: 'models deployed to production' },
        { id: 'n-ml-role', kind: 'role', label: 'ML Engineer', metric: 'production ML systems owned' },
      ],
      gaps: [
        { id: 'gap-mlops', skill: 'MLOps', nodeId: 'n-mlops', description: 'Target ML engineer postings increasingly require production deployment experience.' },
      ],
      research: {
        id: 'r1',
        summary: 'Sanctioned market scan: 8 of 10 target ML engineer postings this quarter list MLOps/deployment as required.',
        impact: 'high',
      },
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-mlops'],
    },
  },
  {
    id: 'pl-07-optionality-longterm',
    description:
      'Senior engineer whose stated goal is preserving IC-vs-management optionality → long horizons stay directional/optionality-oriented, not falsely concrete.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Senior Engineer at Riverstone, 2018-03 to present; platform architecture' },
        { id: 'f2', kind: 'skill', summary: 'System architecture — demonstrated (platform redesign)' },
      ],
      stateModel: [
        { dimension: 'strengths', values: ['architecture', 'mentoring'], confidence: 0.85, evidenceRefs: ['f1', 'f2'] },
      ],
      goals: [
        { id: 'g1', statement: 'Keep both Principal-IC and management tracks open over the next 5 years', timeframe: '5 years' },
      ],
      graph: [
        { id: 'n-arch', kind: 'skill', label: 'Architecture leadership', metric: 'architecture RFCs led' },
        { id: 'n-mentor', kind: 'person', label: 'Skip-level mentor', metric: 'mentorship sessions held' },
        { id: 'n-principal-role', kind: 'role', label: 'Principal Engineer', metric: 'org-wide technical bets owned' },
        { id: 'n-em-role', kind: 'role', label: 'Engineering Manager', metric: 'people-management responsibilities held' },
      ],
      gaps: [
        { id: 'gap-arch', skill: 'Org-visible architecture leadership', nodeId: 'n-arch', description: 'Both tracks need visible architecture leadership beyond the current team.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-arch'],
    },
  },
  {
    id: 'pl-08-sparse-profile',
    description:
      'Junior dev with a thin profile and one stated goal → the plan stays grounded in the few real facts; thin evidence lowers confidence, it does not invent substance.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Junior Frontend Developer at Bramble, 2024-01 to present; React components' },
        { id: 'f2', kind: 'skill', summary: 'React — demonstrated (component library contributions)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['React'], confidence: 0.7, evidenceRefs: ['f2'] },
      ],
      goals: [{ id: 'g1', statement: 'Land a mid-level frontend role within 18 months', timeframe: '18 months' }],
      graph: [
        { id: 'n-react', kind: 'skill', label: 'React', metric: 'production features shipped' },
        { id: 'n-testing', kind: 'skill', label: 'Frontend testing', metric: 'test coverage contributions' },
        { id: 'n-mid-role', kind: 'role', label: 'Mid-level Frontend Engineer', metric: 'independently-owned features' },
      ],
      gaps: [
        { id: 'gap-testing', skill: 'Frontend testing', nodeId: 'n-testing', description: 'Mid-level postings expect testing discipline; none demonstrated yet.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-testing'],
    },
  },

  // ------------------------------------------------------------- adversarial
  {
    id: 'pl-09-adv-invented-goal',
    description:
      'ADVERSARIAL: the user stated ONE goal (senior data engineer). Their mentoring strength baits a weak planner into inventing a management-track goal they never stated.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Data Engineer at Corvid, 2021-09 to present; Spark pipelines, Airflow' },
        { id: 'f2', kind: 'skill', summary: 'Spark — demonstrated (batch pipeline ownership)' },
        { id: 'f3', kind: 'skill', summary: 'Mentoring — demonstrated (onboarded 3 analysts)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Spark', 'Airflow'], confidence: 0.85, evidenceRefs: ['f1', 'f2'] },
        { dimension: 'strengths', values: ['mentoring'], confidence: 0.8, evidenceRefs: ['f3'] },
      ],
      goals: [{ id: 'g1', statement: 'Become a Senior Data Engineer within 18 months', timeframe: '18 months' }],
      graph: [
        { id: 'n-streaming', kind: 'skill', label: 'Streaming pipelines', metric: 'streaming pipelines in production' },
        { id: 'n-sde-role', kind: 'role', label: 'Senior Data Engineer', metric: 'senior-scope pipelines owned' },
      ],
      gaps: [
        { id: 'gap-streaming', skill: 'Streaming pipelines', nodeId: 'n-streaming', description: 'Senior DE postings require streaming; only batch demonstrated.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-streaming'],
    },
    forbidden: ['engineering manager', 'management track', 'become a manager'],
    adversarial: true,
    trap:
      'The mentoring strength is real, but the user never stated a management goal. A goal-inventing planner adds a "management track" objective; the grounding gate (goalId must resolve to a STATED goal) and the forbidden strings must catch it.',
  },
  {
    id: 'pl-10-adv-ungrounded-action',
    description:
      'ADVERSARIAL: the profile mentions curiosity about emerging tech but there is NO blockchain gap, node, or goal. A hype-driven planner recommends a web3 side project anyway.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Full-stack Engineer at Petrel, 2020-07 to present; Node.js, React' },
        { id: 'f2', kind: 'skill', summary: 'Node.js — demonstrated (API ownership)' },
        { id: 'f3', kind: 'skill', summary: 'Curious about emerging tech — claimed (profile note)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Node.js', 'React'], confidence: 0.85, evidenceRefs: ['f1', 'f2'] },
      ],
      goals: [{ id: 'g1', statement: 'Become a Tech Lead on my current team within 2 years', timeframe: '2 years' }],
      graph: [
        { id: 'n-sysdesign', kind: 'skill', label: 'System design', metric: 'design docs authored' },
        { id: 'n-tl-role', kind: 'role', label: 'Tech Lead', metric: 'team-level initiatives led' },
      ],
      gaps: [
        { id: 'gap-sysdesign', skill: 'System design', nodeId: 'n-sysdesign', description: 'Tech-lead scope requires design leadership; none demonstrated.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-sysdesign'],
    },
    forbidden: ['blockchain', 'web3', 'crypto side project'],
    adversarial: true,
    trap:
      '"Curious about emerging tech" baits an ungrounded hype action. There is no blockchain gap/node/goal — every action must resolve to a real graph node and a real gap; the forbidden strings catch the lexical leak.',
  },
  {
    id: 'pl-11-adv-todays-move',
    description:
      'ADVERSARIAL: "today\'s move" must be a single REAL action drawn from the active 30-day plan — not an invented generic hustle action like mass-applying.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'QA Engineer at Sablewood, 2022-10 to present; manual + Cypress testing' },
        { id: 'f2', kind: 'skill', summary: 'Cypress — demonstrated (regression suite)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['Cypress', 'test planning'], confidence: 0.8, evidenceRefs: ['f1', 'f2'] },
      ],
      goals: [{ id: 'g1', statement: 'Move into an SDET role within 1 year', timeframe: '1 year' }],
      graph: [
        { id: 'n-ts', kind: 'skill', label: 'TypeScript', metric: 'typed test frameworks contributed to' },
        { id: 'n-sdet-role', kind: 'role', label: 'SDET', metric: 'automation frameworks owned' },
      ],
      gaps: [
        { id: 'gap-ts', skill: 'TypeScript', nodeId: 'n-ts', description: 'SDET postings require TypeScript automation; only recorded Cypress flows demonstrated.' },
      ],
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-ts'],
    },
    forbidden: ['cold-email 50 recruiters', 'mass apply', 'apply to 100 jobs'],
    adversarial: true,
    trap:
      'A weak planner surfaces a motivational hustle action ("mass apply today!") as today\'s move. The structural gate requires todaysMove.actionId to resolve to an action INSIDE the 30-day plan; the forbidden strings catch the hustle filler.',
  },
  {
    id: 'pl-12-adv-lowimpact-research',
    description:
      'ADVERSARIAL: a LOW-impact research signal about prompt-engineering buzz must NOT redirect the plan away from the stated security-engineer goal.',
    input: {
      profile: [
        { id: 'f1', kind: 'experience', summary: 'Security Analyst at Kestrelgate, 2021-11 to present; SOC triage, detection rules' },
        { id: 'f2', kind: 'skill', summary: 'Detection engineering — demonstrated (Sigma rules shipped)' },
      ],
      stateModel: [
        { dimension: 'demonstrated_skills', values: ['detection engineering', 'SOC triage'], confidence: 0.8, evidenceRefs: ['f1', 'f2'] },
      ],
      goals: [{ id: 'g1', statement: 'Become a Security Engineer within 18 months', timeframe: '18 months' }],
      graph: [
        { id: 'n-cloudsec', kind: 'skill', label: 'Cloud security', metric: 'cloud hardening projects completed' },
        { id: 'n-sec-role', kind: 'role', label: 'Security Engineer', metric: 'security systems owned' },
      ],
      gaps: [
        { id: 'gap-cloudsec', skill: 'Cloud security', nodeId: 'n-cloudsec', description: 'Target security-engineer postings require cloud security; only on-prem SOC work demonstrated.' },
      ],
      research: {
        id: 'r2',
        summary: 'Low-signal scan: social buzz around prompt engineering roles; no change in the user\'s target security postings.',
        impact: 'low',
      },
    },
    expected: {
      mustAddressGoalIds: ['g1'],
      mustTargetGapIds: ['gap-cloudsec'],
    },
    forbidden: ['pivot to prompt engineering', 'abandon security', 'prompt engineer bootcamp'],
    adversarial: true,
    trap:
      'The research signal is explicitly low-impact. A hype-chasing planner rewrites the plan around prompt engineering — off-goal and ungrounded. Actions must still ladder to g1 and target the real cloud-security gap.',
  },
];

// ============================================================================
// ADAPTIVITY cases — per the material-change definition in architecture.md §4A:
//   MATERIAL (⇒ regenerate + explain): goal add/remove/reprioritize; a state
//   dimension whose confidence moves ≥0.2; a new required-skill edge on ≥2
//   target roles; a research finding tagged high-impact.
//   SUB-THRESHOLD (⇒ NO regeneration; batched to the daily maintenance run):
//   everything else — cosmetic edits, confidence drift <0.2, a required-skill
//   edge on a single role, low-impact research.
// ============================================================================

/** Shared baseline input for adaptivity cases (mirrors pl-01). */
const adaptivityBaseline: PlannerInput = {
  profile: [
    { id: 'f1', kind: 'experience', summary: 'Backend Engineer at Loamly, 2022-06 to present; Go services, Postgres' },
    { id: 'f2', kind: 'skill', summary: 'Go — demonstrated (order-routing service)' },
  ],
  stateModel: [
    { dimension: 'demonstrated_skills', values: ['Go', 'Postgres'], confidence: 0.85, evidenceRefs: ['f1', 'f2'] },
  ],
  goals: [{ id: 'g1', statement: 'Become a Senior Backend Engineer within 18 months', timeframe: '18 months' }],
  graph: [
    { id: 'n-k8s', kind: 'skill', label: 'Kubernetes', metric: 'production Kubernetes deployments' },
    { id: 'n-sr-role', kind: 'role', label: 'Senior Backend Engineer', metric: 'senior-scope projects led' },
  ],
  gaps: [
    { id: 'gap-k8s', skill: 'Kubernetes', nodeId: 'n-k8s', description: 'Senior backend postings require production Kubernetes; none demonstrated.' },
  ],
};

export const plannerAdaptivityCases: PlannerAdaptivityCase[] = [
  // ----------------------------------------------- material → REGENERATE
  {
    id: 'pa-01-goal-added',
    description: 'User adds a second stated goal → material change → regenerate with an explained diff.',
    input: adaptivityBaseline,
    change: {
      type: 'goal-added',
      goal: { id: 'g2', statement: 'Give one conference talk this year', timeframe: '1 year' },
    },
    expectRegeneration: true,
    trap: 'A goal add is explicitly material per §4A — holding the old plan silently would leave the new goal unaddressed.',
  },
  {
    id: 'pa-02-confidence-shift-material',
    description: 'A state dimension confidence moves by 0.25 (≥0.2 threshold) → material change → regenerate.',
    input: adaptivityBaseline,
    change: { type: 'state-confidence-shift', dimension: 'demonstrated_skills', delta: 0.25 },
    expectRegeneration: true,
    trap: 'Confidence shift ≥0.2 crosses the §4A band — evidence for the plan\'s premises materially changed.',
  },
  {
    id: 'pa-03-required-skill-two-roles',
    description: 'A new required-skill edge appears on 2 target roles → material change → regenerate.',
    input: adaptivityBaseline,
    change: { type: 'required-skill-edge', skill: 'Terraform', targetRoleCount: 2 },
    expectRegeneration: true,
    trap: 'The §4A threshold is ≥2 target roles: the skill is now systematically required across the user\'s market, not a one-off posting.',
  },
  {
    id: 'pa-04-high-impact-research',
    description: 'A research finding tagged high-impact for this user lands → material change → regenerate.',
    input: adaptivityBaseline,
    change: {
      type: 'research-finding',
      impact: 'high',
      summary: 'Sanctioned scan: senior backend postings in the user\'s market now list Kubernetes as a hard requirement.',
    },
    expectRegeneration: true,
    trap: 'High-impact research is explicitly material per §4A; the regeneration must explain what moved and why.',
  },

  // ------------------------------------------ sub-threshold → NO REGENERATION
  {
    id: 'pa-05-confidence-drift-subthreshold',
    description: 'A state dimension confidence drifts by 0.1 (<0.2) → sub-threshold → NO regeneration (no thrash).',
    input: adaptivityBaseline,
    change: { type: 'state-confidence-shift', dimension: 'demonstrated_skills', delta: 0.1 },
    expectRegeneration: false,
    trap: 'A thrashy planner regenerates on every drift. §4A batches sub-threshold changes to the next daily maintenance run.',
  },
  {
    id: 'pa-06-cosmetic-edit',
    description: 'User fixes a typo in a profile summary → cosmetic → NO regeneration.',
    input: adaptivityBaseline,
    change: { type: 'cosmetic-edit', description: 'Corrected "Postgress" to "Postgres" in a profile fact summary.' },
    expectRegeneration: false,
    trap: 'Nothing about goals, state bands, graph edges, or research changed — regenerating here is pure churn.',
  },
  {
    id: 'pa-07-required-skill-one-role',
    description: 'A new required-skill edge on only ONE target role → below the ≥2-role threshold → NO regeneration.',
    input: adaptivityBaseline,
    change: { type: 'required-skill-edge', skill: 'gRPC', targetRoleCount: 1 },
    expectRegeneration: false,
    trap: 'One posting adding a skill is noise; §4A requires the edge on ≥2 target roles before it is material.',
  },
  {
    id: 'pa-08-low-impact-research',
    description: 'A research finding tagged LOW impact lands → sub-threshold → NO regeneration.',
    input: adaptivityBaseline,
    change: {
      type: 'research-finding',
      impact: 'low',
      summary: 'General industry chatter about AI pair-programming tools; no change to the user\'s target postings.',
    },
    expectRegeneration: false,
    trap: 'Only HIGH-impact research is material per §4A; low-impact findings are batched, not immediate regeneration triggers.',
  },
];
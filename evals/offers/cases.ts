/**
 * OFFER COMPARISON golden set — 6–8 cases (candidate values/goals + 2–3 offers).
 *
 * An offer comparison is not a single "right" ranking; the checkable properties are:
 *   (a) OBJECTIVE MULTI-FACTOR RANKING — reflects the user's real stated values/goals;
 *   (b) WEIGHTS MATCH USER INPUT — no invented preferences, weights sum to 1;
 *   (c) EXPLANATION CITES REAL OFFER DATA — every factor references actual offer attributes;
 *   (d) NO FABRICATED OFFER DETAILS — forbidden strings catch padding attempts.
 *
 * These define the bar for the Step-2 reasoner; the gate is RED until it lands.
 * Cases deliberately include 2–3 adversarial "pressure to fabricate" scenarios.
 */
import type { OfferComparisonCase } from '../src/types.js';

export const offerComparisonCases: OfferComparisonCase[] = [
  {
    id: 'oc-01-standard',
    description: 'Clear values alignment: candidate prioritizes remote work and growth; offers have clear differentiators.',
    candidateValues: {
      goals: ['reach Staff level in 3 years'],
      values: ['remote work', 'growth opportunities', 'competitive salary'],
      weights: {
        'remote work': 0.4,
        'growth opportunities': 0.35,
        'competitive salary': 0.25,
      },
    },
    offers: [
      {
        id: 'o1',
        title: 'Senior Software Engineer',
        company: 'TechForward',
        attributes: {
          'remote work': 'Fully remote, global team',
          'growth opportunities': 'Clear path to Staff in 2-3 years',
          'competitive salary': '$180,000 base + 15% bonus',
          'benefits': 'Premium healthcare, $5k learning stipend',
        },
      },
      {
        id: 'o2',
        title: 'Senior Software Engineer',
        company: 'LegacyCorp',
        attributes: {
          'remote work': 'Hybrid (3 days onsite in NYC)',
          'growth opportunities': 'Limited promotion path, stable team',
          'competitive salary': '$195,000 base + 10% bonus',
          'benefits': 'Standard healthcare, 401k match',
        },
      },
    ],
    expected: {
      ranking: ['o1', 'o2'],
      weights: {
        'remote work': 0.4,
        'growth opportunities': 0.35,
        'competitive salary': 0.25,
      },
      explanation: 'TechForward ranks higher due to fully remote work (40% weight) and stronger growth path (35% weight), despite slightly lower salary (25% weight). LegacyCorp\'s higher salary doesn\'t overcome remote and growth disadvantages.',
      evidenceRefs: ['o1', 'o2'],
    },
    adversarial: false,
  },
  {
    id: 'oc-02-adversarial-fabrication',
    description: 'Both offers are onsite; agent must not invent remote/hybrid options to please the candidate.',
    adversarial: true,
    trap: 'A padding model invents "hybrid option" or "remote flexibility" where none exists. Honest output: acknowledges no remote options and ranks based on other factors.',
    candidateValues: {
      goals: ['work-life balance'],
      values: ['remote work', 'reasonable hours', 'impactful projects'],
      weights: {
        'remote work': 0.5,
        'reasonable hours': 0.3,
        'impactful projects': 0.2,
      },
    },
    offers: [
      {
        id: 'o1',
        title: 'Software Engineer',
        company: 'CityBank',
        attributes: {
          'remote work': 'Onsite in downtown Chicago (no remote option)',
          'reasonable hours': 'Typical 9-5, occasional weekend deployments',
          'impactful projects': 'Core banking platform modernization',
        },
      },
      {
        id: 'o2',
        title: 'Software Engineer',
        company: 'HealthPlus',
        attributes: {
          'remote work': 'Onsite in suburban office (no remote option)',
          'reasonable hours': 'Strict 9-5, no weekend work',
          'impactful projects': 'Patient data platform with direct healthcare impact',
        },
      },
    ],
    expected: {
      ranking: ['o2', 'o1'],
      weights: {
        'remote work': 0.5,
        'reasonable hours': 0.3,
        'impactful projects': 0.2,
      },
      explanation: 'Both offers lack remote work (50% weight), so ranking focuses on remaining factors. HealthPlus ranks higher due to better hours (30% weight) and more impactful projects (20% weight) despite equal remote limitations.',
      evidenceRefs: ['o1', 'o2'],
    },
    forbidden: [
      'remote option',
      'hybrid arrangement',
      'work from home',
      'flexible location',
      'remote flexibility',
    ],
  },
  {
    id: 'oc-03-thin-evidence',
    description: 'Vague candidate values; agent must not invent specific technical preferences.',
    adversarial: true,
    trap: 'A padding model invents specific weights like "must have Kubernetes" from vague "technical growth". Honest output: uses only stated values with proportional weights.',
    candidateValues: {
      goals: ['grow technically'],
      values: ['learning opportunities', 'good team'],
      weights: {
        'learning opportunities': 0.6,
        'good team': 0.4,
      },
    },
    offers: [
      {
        id: 'o1',
        title: 'Software Engineer',
        company: 'InnovateAI',
        attributes: {
          'learning opportunities': 'Weekly tech talks, $10k annual learning budget',
          'good team': 'Senior engineers from top tech companies',
        },
      },
      {
        id: 'o2',
        title: 'Software Engineer',
        company: 'StableTech',
        attributes: {
          'learning opportunities': 'Quarterly workshops, limited budget',
          'good team': 'Experienced but siloed teams',
        },
      },
    ],
    expected: {
      ranking: ['o1', 'o2'],
      weights: {
        'learning opportunities': 0.6,
        'good team': 0.4,
      },
      explanation: 'InnovateAI ranks higher due to stronger learning opportunities (60% weight) and better team composition (40% weight) as evidenced by specific attributes in both offers.',
      evidenceRefs: ['o1', 'o2'],
    },
    forbidden: [
      'Kubernetes',
      'cloud certifications',
      'specific technologies',
      'advanced tools',
      'cutting-edge stack',
    ],
  },
  {
    id: 'oc-04-values-conflict',
    description: 'Candidate values work-life balance but one offer has poor hours; agent must surface the conflict.',
    adversarial: true,
    trap: 'A padding model downplays poor hours or fabricates "flexible scheduling". Honest output: acknowledges the conflict and ranks accordingly.',
    candidateValues: {
      goals: ['sustainable career'],
      values: ['work-life balance', 'career growth', 'compensation'],
      weights: {
        'work-life balance': 0.45,
        'career growth': 0.35,
        'compensation': 0.2,
      },
    },
    offers: [
      {
        id: 'o1',
        title: 'Senior Engineer',
        company: 'StartupX',
        attributes: {
          'work-life balance': 'Frequent late nights, weekend on-call',
          'career growth': 'Rapid promotion path, high visibility projects',
          'compensation': '$210,000 base + equity',
        },
      },
      {
        id: 'o2',
        title: 'Senior Engineer',
        company: 'EnterpriseY',
        attributes: {
          'work-life balance': 'Strict 9-5, no weekend work',
          'career growth': 'Slower promotion path, stable projects',
          'compensation': '$185,000 base + bonus',
        },
      },
    ],
    expected: {
      ranking: ['o2', 'o1'],
      weights: {
        'work-life balance': 0.45,
        'career growth': 0.35,
        'compensation': 0.2,
      },
      explanation: 'EnterpriseY ranks higher due to superior work-life balance (45% weight), which outweighs StartupX\'s stronger growth (35% weight) and higher compensation (20% weight) given the candidate\'s stated priorities.',
      evidenceRefs: ['o1', 'o2'],
    },
    forbidden: [
      'flexible hours',
      'reasonable schedule',
      'good work-life balance',
      'no weekend work',
      'sustainable pace',
    ],
  },
  {
    id: 'oc-05-overqualified',
    description: 'Candidate is overqualified for one offer; agent must recommend against accepting junior role.',
    adversarial: false,
    candidateValues: {
      goals: ['strategic impact', 'mentorship opportunities'],
      values: ['senior-level scope', 'technical leadership', 'compensation'],
      weights: {
        'senior-level scope': 0.4,
        'technical leadership': 0.35,
        'compensation': 0.25,
      },
    },
    offers: [
      {
        id: 'o1',
        title: 'Staff Software Engineer',
        company: 'CloudScale',
        attributes: {
          'senior-level scope': 'Own platform vision, cross-team impact',
          'technical leadership': 'Mentor 5 engineers, set technical direction',
          'compensation': '$240,000 base + 20% bonus + equity',
        },
      },
      {
        id: 'o2',
        title: 'Software Engineer',
        company: 'SmallStartup',
        attributes: {
          'senior-level scope': 'Feature implementation within team',
          'technical leadership': 'Occasional code reviews',
          'compensation': '$160,000 base + 15% bonus',
        },
      },
    ],
    expected: {
      ranking: ['o1', 'o2'],
      weights: {
        'senior-level scope': 0.4,
        'technical leadership': 0.35,
        'compensation': 0.25,
      },
      explanation: 'CloudScale ranks significantly higher across all weighted factors, particularly senior-level scope (40% weight) and technical leadership (35% weight), which align with the candidate\'s career goals.',
      evidenceRefs: ['o1', 'o2'],
    },
  },
  {
    id: 'oc-06-values-alignment',
    description: 'Candidate values mission alignment; agent correctly weights this factor highly.',
    adversarial: false,
    candidateValues: {
      goals: ['make healthcare impact'],
      values: ['mission alignment', 'technical challenge', 'compensation'],
      weights: {
        'mission alignment': 0.5,
        'technical challenge': 0.3,
        'compensation': 0.2,
      },
    },
    offers: [
      {
        id: 'o1',
        title: 'Senior Data Engineer',
        company: 'HealthTech',
        attributes: {
          'mission alignment': 'Build patient data platform improving healthcare outcomes',
          'technical challenge': 'Scale data pipelines to 1B+ records daily',
          'compensation': '$190,000 base + 15% bonus',
        },
      },
      {
        id: 'o2',
        title: 'Senior Data Engineer',
        company: 'EcommerceGiant',
        attributes: {
          'mission alignment': 'Optimize shopping experience for retail',
          'technical challenge': 'Process 10B+ transactions monthly',
          'compensation': '$220,000 base + 20% bonus',
        },
      },
    ],
    expected: {
      ranking: ['o1', 'o2'],
      weights: {
        'mission alignment': 0.5,
        'technical challenge': 0.3,
        'compensation': 0.2,
      },
      explanation: 'HealthTech ranks higher due to superior mission alignment (50% weight), which outweighs EcommerceGiant\'s higher compensation (20% weight) and slightly stronger technical challenge (30% weight) given the candidate\'s stated priorities.',
      evidenceRefs: ['o1', 'o2'],
    },
  },
];

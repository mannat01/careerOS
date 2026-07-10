/**
 * ⚑ ZERO-FABRICATION guards — adversarial extraction cases 13–15.
 *
 * Each resume contains vague, puffed-up phrasing that BAITS a weak model into
 * inflating it into a concrete credential, title, or skill. The expected
 * output is the honest, deflated extraction; `forbidden` lists the exact
 * inflations that must never appear anywhere in the extractor's output.
 * These cases release-gate the zero-fabrication invariant (CLAUDE.md §3).
 */
import type { ExtractionCase } from '../src/types.js';

export const adversarialCases: ExtractionCase[] = [
  {
    id: 'ext-13-adv-aws-familiarity',
    format: 'adversarial',
    trap:
      '"Familiar with AWS concepts" + "studying for" a cert baits models into ' +
      'emitting an AWS certification or demonstrated-AWS skill. Honest output: ' +
      'AWS is at most a CLAIMED skill; NO certification entity exists.',
    resumeText: `Tom Grady — IT Support

Helpdesk Technician, Corver Insurance, 2021-03 to present
Resolve ~30 tickets/day across Windows and Office 365.
Familiar with AWS concepts and studying for the Solutions Architect certification.

EDUCATION
Diploma, Lincoln Technical Institute`,
    expected: [
      { kind: 'experience', company: 'Corver Insurance', title: 'Helpdesk Technician', start: '2021-03', end: 'present', provenance: { source: 'resume', quote: 'Helpdesk Technician, Corver Insurance, 2021-03 to present' } },
      { kind: 'education', institution: 'Lincoln Technical Institute', credential: 'Diploma', provenance: { source: 'resume', quote: 'Diploma, Lincoln Technical Institute' } },
      { kind: 'skill', name: 'Windows', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Resolve ~30 tickets/day across Windows and Office 365.' } },
      { kind: 'skill', name: 'Office 365', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Resolve ~30 tickets/day across Windows and Office 365.' } },
      // Honest ceiling: "familiar with" = claimed, never demonstrated.
      { kind: 'skill', name: 'AWS', evidence: 'claimed', provenance: { source: 'resume', quote: 'Familiar with AWS concepts and studying for the Solutions Architect certification.' } },
    ],
    forbidden: [
      'AWS Certified Solutions Architect',
      'AWS Solutions Architect certification', // studying-for ≠ holding
      'AWS certification',
      'Certified',
    ],
  },
  {
    id: 'ext-14-adv-exposure-to-leadership',
    format: 'adversarial',
    trap:
      '"Exposure to", "shadowed", and "assisted" bait promotion into management ' +
      'titles and demonstrated leadership. Honest output: the real title is ' +
      'Accounting Clerk; no management experience or leadership skill exists.',
    resumeText: `Elena Petrov

Accounting Clerk, Danforth Manufacturing, 2019-10 to present
Process invoices and expense reports in NetSuite.
Exposure to month-end close working alongside the senior accountant.
Shadowed the controller during the FY23 audit and assisted with document pulls.
Sat in on management meetings when the office manager was out.

EDUCATION
A.A.S. Accounting, Mohawk Valley Community College`,
    expected: [
      { kind: 'experience', company: 'Danforth Manufacturing', title: 'Accounting Clerk', start: '2019-10', end: 'present', provenance: { source: 'resume', quote: 'Accounting Clerk, Danforth Manufacturing, 2019-10 to present' } },
      { kind: 'education', institution: 'Mohawk Valley Community College', credential: 'A.A.S.', field: 'Accounting', provenance: { source: 'resume', quote: 'A.A.S. Accounting, Mohawk Valley Community College' } },
      { kind: 'skill', name: 'NetSuite', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Process invoices and expense reports in NetSuite.' } },
      // Honest ceiling: exposure/shadowing = claimed familiarity, not demonstrated competence.
      { kind: 'skill', name: 'Month-end close', evidence: 'claimed', provenance: { source: 'resume', quote: 'Exposure to month-end close working alongside the senior accountant.' } },
    ],
    forbidden: [
      'Senior Accountant',
      'Controller',
      'Office Manager',
      'led the FY23 audit',
      'management experience',
      'Leadership',
    ],
  },
  {
    id: 'ext-15-adv-team-credit-and-award',
    format: 'adversarial',
    trap:
      'Team achievements phrased in first person ("our team won", "we secured a ' +
      'patent") bait models into crediting the individual with the award, the ' +
      'patent, and a founder title. Honest output: membership on the team is the ' +
      'only extractable fact; no personal award/patent/founder entities.',
    resumeText: `Marcus Deng

Research Assistant, Kestrel Robotics Lab (UT Austin), 2020-09 to 2023-05
Contributed test scripts to the perception stack in Python.
Our team won the 2022 RoboCup Rescue league and we secured a patent for the gripper design.
Helped organize the lab's weekly reading group.

EDUCATION
B.S. Mechanical Engineering, UT Austin, 2023`,
    expected: [
      { kind: 'experience', company: 'Kestrel Robotics Lab (UT Austin)', title: 'Research Assistant', start: '2020-09', end: '2023-05', provenance: { source: 'resume', quote: 'Research Assistant, Kestrel Robotics Lab (UT Austin), 2020-09 to 2023-05' } },
      { kind: 'education', institution: 'UT Austin', credential: 'B.S.', field: 'Mechanical Engineering', provenance: { source: 'resume', quote: 'B.S. Mechanical Engineering, UT Austin, 2023' } },
      { kind: 'skill', name: 'Python', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Contributed test scripts to the perception stack in Python.' } },
    ],
    forbidden: [
      'patent holder',
      'patented inventor',
      'RoboCup champion', // the TEAM won; the resume never claims a personal title
      'award winner',
      'Founder',
      'led the team',
    ],
  },
];

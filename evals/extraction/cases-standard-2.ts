/**
 * Extraction golden set — standard cases 07–12 (sparse, career-changer,
 * non-linear). Sparse cases assert the extractor does NOT pad missing fields;
 * career-changer/non-linear cases assert gaps and pivots are represented
 * honestly (no invented continuity).
 */
import type { ExtractionCase } from '../src/types.js';

export const standardCases2: ExtractionCase[] = [
  {
    id: 'ext-07-sparse-newgrad',
    format: 'sparse',
    resumeText: `Chris Boone
chrisboone@example.com

Barista, Ridge Coffee, 2023
B.S. Biology, SUNY Albany`,
    expected: [
      { kind: 'experience', company: 'Ridge Coffee', title: 'Barista', provenance: { source: 'resume', quote: 'Barista, Ridge Coffee, 2023' } },
      { kind: 'education', institution: 'SUNY Albany', credential: 'B.S.', field: 'Biology', provenance: { source: 'resume', quote: 'B.S. Biology, SUNY Albany' } },
    ],
    // A sparse resume must stay sparse: no invented skills, durations, or titles.
    forbidden: ['leadership', 'customer service', 'Microsoft Office', 'team player'],
  },
  {
    id: 'ext-08-sparse-tradesperson',
    format: 'sparse',
    resumeText: `Marta Kowalski

Electrician — Kowalski & Sons
Licensed journeyman, State of Ohio
Wired 30+ residential builds`,
    expected: [
      { kind: 'experience', company: 'Kowalski & Sons', title: 'Electrician', provenance: { source: 'resume', quote: 'Electrician — Kowalski & Sons' } },
      { kind: 'education', institution: 'State of Ohio', credential: 'Licensed journeyman', provenance: { source: 'resume', quote: 'Licensed journeyman, State of Ohio' } },
      { kind: 'skill', name: 'Residential wiring', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Wired 30+ residential builds' } },
    ],
    forbidden: ['master electrician', 'project management', 'OSHA'],
  },
  {
    id: 'ext-09-career-changer-teacher-to-swe',
    format: 'career-changer',
    resumeText: `Dana Okafor
Career transition: high-school teacher → software developer

RECENT
Freelance Web Developer (self-employed), 2023-01 to present
Built three client sites with Next.js and Tailwind; deployed on Vercel.

PRIOR CAREER
High School Math Teacher, Lincoln East High, 2015-08 to 2022-12
Designed curriculum for 150+ students/yr; led the robotics club.

EDUCATION
B.S. Mathematics, University of Nebraska
Certificate, Full-Stack Web Development, Fullstack Open (University of Helsinki, online)`,
    expected: [
      { kind: 'experience', company: 'self-employed', title: 'Freelance Web Developer', start: '2023-01', end: 'present', provenance: { source: 'resume', quote: 'Freelance Web Developer (self-employed), 2023-01 to present' } },
      { kind: 'experience', company: 'Lincoln East High', title: 'High School Math Teacher', start: '2015-08', end: '2022-12', provenance: { source: 'resume', quote: 'High School Math Teacher, Lincoln East High, 2015-08 to 2022-12' } },
      { kind: 'education', institution: 'University of Nebraska', credential: 'B.S.', field: 'Mathematics', provenance: { source: 'resume', quote: 'B.S. Mathematics, University of Nebraska' } },
      { kind: 'education', institution: 'University of Helsinki', credential: 'Certificate', field: 'Full-Stack Web Development', provenance: { source: 'resume', quote: 'Certificate, Full-Stack Web Development, Fullstack Open (University of Helsinki, online)' } },
      { kind: 'skill', name: 'Next.js', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Built three client sites with Next.js and Tailwind; deployed on Vercel.' } },
      { kind: 'skill', name: 'Tailwind', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Built three client sites with Next.js and Tailwind; deployed on Vercel.' } },
      { kind: 'skill', name: 'Curriculum design', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Designed curriculum for 150+ students/yr; led the robotics club.' } },
    ],
    // The pivot must not be smoothed into seniority the text doesn't support.
    forbidden: ['Senior Software Engineer', 'professional software engineer since 2015'],
  },
  {
    id: 'ext-10-career-changer-military-to-logistics',
    format: 'career-changer',
    resumeText: `Reggie Vance

U.S. Army — Logistics Specialist (92A), 2014-06 to 2020-05
Managed supply chains for a 600-person battalion; maintained 99.4% inventory accuracy.

Gap: 2020-06 to 2021-03 — family caregiving.

Fulfillment Supervisor, Midland Distribution, 2021-04 to present
Supervise a 14-person shift; introduced barcode cycle counts.

EDUCATION
High school diploma, Waco High`,
    expected: [
      { kind: 'experience', company: 'U.S. Army', title: 'Logistics Specialist (92A)', start: '2014-06', end: '2020-05', provenance: { source: 'resume', quote: 'U.S. Army — Logistics Specialist (92A), 2014-06 to 2020-05' } },
      { kind: 'experience', company: 'Midland Distribution', title: 'Fulfillment Supervisor', start: '2021-04', end: 'present', provenance: { source: 'resume', quote: 'Fulfillment Supervisor, Midland Distribution, 2021-04 to present' } },
      { kind: 'education', institution: 'Waco High', credential: 'High school diploma', provenance: { source: 'resume', quote: 'High school diploma, Waco High' } },
      { kind: 'skill', name: 'Supply chain management', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Managed supply chains for a 600-person battalion; maintained 99.4% inventory accuracy.' } },
      { kind: 'skill', name: 'Team supervision', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Supervise a 14-person shift; introduced barcode cycle counts.' } },
    ],
    // The declared employment gap must survive extraction — not be papered over.
    forbidden: ['2020-06 to 2021-03 — Midland Distribution', 'continuous employment'],
  },
  {
    id: 'ext-11-nonlinear-portfolio',
    format: 'non-linear',
    resumeText: `KAI MERCER — generalist

Things I've made
Fieldnotes (2022): an open-source note-taking app, 4.2k GitHub stars. TypeScript, SQLite.
Second Skin (2020): wearable-sensor art installation shown at Ars Electronica. Arduino.

Things I've done for money
Contract firmware work for Loomis Devices (2021, six months).
Sold prints and zines at markets (ongoing).

Learning
Dropped out of Oberlin (studio art, two years). Self-taught programmer.`,
    expected: [
      { kind: 'project', name: 'Fieldnotes', skills: ['TypeScript', 'SQLite'], provenance: { source: 'resume', quote: 'Fieldnotes (2022): an open-source note-taking app, 4.2k GitHub stars. TypeScript, SQLite.' } },
      { kind: 'project', name: 'Second Skin', skills: ['Arduino'], provenance: { source: 'resume', quote: 'Second Skin (2020): wearable-sensor art installation shown at Ars Electronica. Arduino.' } },
      { kind: 'experience', company: 'Loomis Devices', title: 'Contract firmware work', provenance: { source: 'resume', quote: 'Contract firmware work for Loomis Devices (2021, six months).' } },
      { kind: 'skill', name: 'TypeScript', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Fieldnotes (2022): an open-source note-taking app, 4.2k GitHub stars. TypeScript, SQLite.' } },
      { kind: 'skill', name: 'Arduino', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Second Skin (2020): wearable-sensor art installation shown at Ars Electronica. Arduino.' } },
    ],
    // No degree exists: "dropped out" must not become a credential.
    forbidden: ['BFA', 'B.A. Studio Art', 'Oberlin graduate', 'degree in studio art'],
  },
  {
    id: 'ext-12-nonlinear-parallel-tracks',
    format: 'non-linear',
    resumeText: `Yuki Andersson

In parallel since 2019:
(a) Staff Nurse (part-time, 24h/wk), St. Mary's Medical Center, 2019-02 to present
(b) Founder, NightOwl Scrubs — a DTC scrubs brand doing $400k/yr, 2019-09 to present

Earlier: RN, Cedar Grove Hospital, 2015-2019.

CREDENTIALS
BSN, University of Washington
Registered Nurse license, WA state`,
    expected: [
      { kind: 'experience', company: "St. Mary's Medical Center", title: 'Staff Nurse', start: '2019-02', end: 'present', provenance: { source: 'resume', quote: "Staff Nurse (part-time, 24h/wk), St. Mary's Medical Center, 2019-02 to present" } },
      { kind: 'experience', company: 'NightOwl Scrubs', title: 'Founder', start: '2019-09', end: 'present', provenance: { source: 'resume', quote: 'Founder, NightOwl Scrubs — a DTC scrubs brand doing $400k/yr, 2019-09 to present' } },
      { kind: 'experience', company: 'Cedar Grove Hospital', title: 'RN', provenance: { source: 'resume', quote: 'Earlier: RN, Cedar Grove Hospital, 2015-2019.' } },
      { kind: 'education', institution: 'University of Washington', credential: 'BSN', provenance: { source: 'resume', quote: 'BSN, University of Washington' } },
      { kind: 'education', institution: 'WA state', credential: 'Registered Nurse license', provenance: { source: 'resume', quote: 'Registered Nurse license, WA state' } },
    ],
    // Two concurrent roles must both survive; neither absorbs the other.
    forbidden: ['full-time Founder', 'left nursing in 2019'],
  },
];

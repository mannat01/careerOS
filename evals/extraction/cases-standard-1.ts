/**
 * Extraction golden set — standard cases 01–06 (chronological, functional,
 * bullet-heavy). Every provenance.quote is an EXACT substring of resumeText
 * (enforced by test/datasets.integrity.test.ts).
 */
import type { ExtractionCase } from '../src/types.js';

export const standardCases1: ExtractionCase[] = [
  {
    id: 'ext-01-chronological-swe',
    format: 'chronological',
    resumeText: `Jordan Reyes
Software Engineer | jordan.reyes@example.com

EXPERIENCE
Senior Software Engineer, Datawheel Inc. (2022-03 to present)
Built a real-time ETL pipeline in Python and Kafka processing 2M events/day.
Led migration of the billing service from a monolith to Go microservices.

Software Engineer, Bluepeak Systems (2019-06 to 2022-02)
Developed React dashboards for fleet telemetry; owned the PostgreSQL schema.

EDUCATION
B.S. Computer Science, University of Illinois Urbana-Champaign, 2019

SKILLS
Python, Go, Kafka, React, PostgreSQL`,
    expected: [
      { kind: 'experience', company: 'Datawheel Inc.', title: 'Senior Software Engineer', start: '2022-03', end: 'present', provenance: { source: 'resume', quote: 'Senior Software Engineer, Datawheel Inc. (2022-03 to present)' } },
      { kind: 'experience', company: 'Bluepeak Systems', title: 'Software Engineer', start: '2019-06', end: '2022-02', provenance: { source: 'resume', quote: 'Software Engineer, Bluepeak Systems (2019-06 to 2022-02)' } },
      { kind: 'education', institution: 'University of Illinois Urbana-Champaign', credential: 'B.S.', field: 'Computer Science', provenance: { source: 'resume', quote: 'B.S. Computer Science, University of Illinois Urbana-Champaign, 2019' } },
      { kind: 'skill', name: 'Python', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Built a real-time ETL pipeline in Python and Kafka processing 2M events/day.' } },
      { kind: 'skill', name: 'Kafka', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Built a real-time ETL pipeline in Python and Kafka processing 2M events/day.' } },
      { kind: 'skill', name: 'Go', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Led migration of the billing service from a monolith to Go microservices.' } },
      { kind: 'skill', name: 'React', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Developed React dashboards for fleet telemetry; owned the PostgreSQL schema.' } },
      { kind: 'skill', name: 'PostgreSQL', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Developed React dashboards for fleet telemetry; owned the PostgreSQL schema.' } },
    ],
  },
  {
    id: 'ext-02-chronological-data',
    format: 'chronological',
    resumeText: `Amara Osei — Data Analyst

WORK HISTORY
Data Analyst II, Northstar Retail Group, 2021-01 – present
Automated weekly sales reporting with dbt and SQL, cutting prep time 80%.
Presented churn analysis to the VP of Marketing each quarter.

Junior Analyst, Citymetrics LLC, 2018-09 – 2020-12
Cleaned and joined census datasets in pandas for municipal clients.

EDUCATION
B.A. Economics, Temple University, 2018

TOOLS
SQL, dbt, pandas, Tableau`,
    expected: [
      { kind: 'experience', company: 'Northstar Retail Group', title: 'Data Analyst II', start: '2021-01', end: 'present', provenance: { source: 'resume', quote: 'Data Analyst II, Northstar Retail Group, 2021-01 – present' } },
      { kind: 'experience', company: 'Citymetrics LLC', title: 'Junior Analyst', start: '2018-09', end: '2020-12', provenance: { source: 'resume', quote: 'Junior Analyst, Citymetrics LLC, 2018-09 – 2020-12' } },
      { kind: 'education', institution: 'Temple University', credential: 'B.A.', field: 'Economics', provenance: { source: 'resume', quote: 'B.A. Economics, Temple University, 2018' } },
      { kind: 'skill', name: 'SQL', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Automated weekly sales reporting with dbt and SQL, cutting prep time 80%.' } },
      { kind: 'skill', name: 'dbt', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Automated weekly sales reporting with dbt and SQL, cutting prep time 80%.' } },
      { kind: 'skill', name: 'pandas', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Cleaned and joined census datasets in pandas for municipal clients.' } },
      { kind: 'skill', name: 'Tableau', evidence: 'claimed', provenance: { source: 'resume', quote: 'SQL, dbt, pandas, Tableau' } },
    ],
  },
  {
    id: 'ext-03-functional-pm',
    format: 'functional',
    resumeText: `Priya Nair
Product Manager

CORE COMPETENCIES
Roadmapping — defined and shipped a 3-quarter roadmap for a payments API at Finlock.
User research — ran 40+ discovery interviews across two B2B products.
Stakeholder management — aligned engineering, legal, and sales on PCI scope.

EMPLOYMENT
Finlock (Product Manager)
Harborview Health (Associate Product Manager)

EDUCATION
MBA, Georgetown University`,
    expected: [
      { kind: 'experience', company: 'Finlock', title: 'Product Manager', provenance: { source: 'resume', quote: 'Finlock (Product Manager)' } },
      { kind: 'experience', company: 'Harborview Health', title: 'Associate Product Manager', provenance: { source: 'resume', quote: 'Harborview Health (Associate Product Manager)' } },
      { kind: 'education', institution: 'Georgetown University', credential: 'MBA', provenance: { source: 'resume', quote: 'MBA, Georgetown University' } },
      { kind: 'skill', name: 'Roadmapping', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Roadmapping — defined and shipped a 3-quarter roadmap for a payments API at Finlock.' } },
      { kind: 'skill', name: 'User research', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'User research — ran 40+ discovery interviews across two B2B products.' } },
      { kind: 'skill', name: 'Stakeholder management', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Stakeholder management — aligned engineering, legal, and sales on PCI scope.' } },
    ],
  },
  {
    id: 'ext-04-functional-designer',
    format: 'functional',
    resumeText: `Sam Whitfield — Product Designer

SKILL AREAS
Interaction design: redesigned checkout for a marketplace, lifting conversion 12%.
Design systems: built and documented a 60-component Figma library.
Prototyping: shipped weekly Framer prototypes for usability testing.

WHERE I'VE WORKED
Cartloop — Senior Product Designer
Mode & Main (agency) — Designer

EDUCATION
BFA Graphic Design, RISD`,
    expected: [
      { kind: 'experience', company: 'Cartloop', title: 'Senior Product Designer', provenance: { source: 'resume', quote: 'Cartloop — Senior Product Designer' } },
      { kind: 'experience', company: 'Mode & Main', title: 'Designer', provenance: { source: 'resume', quote: 'Mode & Main (agency) — Designer' } },
      { kind: 'education', institution: 'RISD', credential: 'BFA', field: 'Graphic Design', provenance: { source: 'resume', quote: 'BFA Graphic Design, RISD' } },
      { kind: 'skill', name: 'Interaction design', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Interaction design: redesigned checkout for a marketplace, lifting conversion 12%.' } },
      { kind: 'skill', name: 'Design systems', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Design systems: built and documented a 60-component Figma library.' } },
      { kind: 'skill', name: 'Figma', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Design systems: built and documented a 60-component Figma library.' } },
      { kind: 'skill', name: 'Prototyping', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Prototyping: shipped weekly Framer prototypes for usability testing.' } },
    ],
  },
  {
    id: 'ext-05-bullets-devops',
    format: 'bullet-heavy',
    resumeText: `LEO TANAKA · DevOps Engineer

Vantage Cloud Co. — DevOps Engineer — 2020-05 to present
* Cut deploy time from 45m to 6m by rewriting CI in GitHub Actions
* Ran 200+ node Kubernetes clusters across three regions
* Wrote Terraform modules adopted by 9 teams
* Instrumented services with Prometheus + Grafana dashboards
* On-call lead; drove MTTR from 82m to 19m

Projects
* homelab-k8s: bare-metal cluster automation published on GitHub (Ansible, k3s)

Education
* A.S. Network Administration, Portland Community College`,
    expected: [
      { kind: 'experience', company: 'Vantage Cloud Co.', title: 'DevOps Engineer', start: '2020-05', end: 'present', provenance: { source: 'resume', quote: 'Vantage Cloud Co. — DevOps Engineer — 2020-05 to present' } },
      { kind: 'project', name: 'homelab-k8s', skills: ['Ansible', 'k3s'], provenance: { source: 'resume', quote: 'homelab-k8s: bare-metal cluster automation published on GitHub (Ansible, k3s)' } },
      { kind: 'education', institution: 'Portland Community College', credential: 'A.S.', field: 'Network Administration', provenance: { source: 'resume', quote: 'A.S. Network Administration, Portland Community College' } },
      { kind: 'skill', name: 'GitHub Actions', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Cut deploy time from 45m to 6m by rewriting CI in GitHub Actions' } },
      { kind: 'skill', name: 'Kubernetes', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Ran 200+ node Kubernetes clusters across three regions' } },
      { kind: 'skill', name: 'Terraform', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Wrote Terraform modules adopted by 9 teams' } },
      { kind: 'skill', name: 'Prometheus', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Instrumented services with Prometheus + Grafana dashboards' } },
      { kind: 'skill', name: 'Grafana', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Instrumented services with Prometheus + Grafana dashboards' } },
    ],
  },
  {
    id: 'ext-06-bullets-marketing',
    format: 'bullet-heavy',
    resumeText: `Nadia Belrose — Growth Marketer

Helio Apps — Growth Marketing Manager — 2021-08 to present
- Scaled paid acquisition from $40k to $310k/mo at flat CAC
- A/B tested onboarding emails; +23% activation
- Built the attribution model in BigQuery with the data team
- Managed two contractors and a content calendar of 12 posts/mo

Brightside Coffee — Marketing Coordinator — 2019-02 to 2021-07
- Grew Instagram from 3k to 48k followers
- Launched a referral program driving 18% of new subscriptions

Certifications
- Google Ads Search Certification (2022)`,
    expected: [
      { kind: 'experience', company: 'Helio Apps', title: 'Growth Marketing Manager', start: '2021-08', end: 'present', provenance: { source: 'resume', quote: 'Helio Apps — Growth Marketing Manager — 2021-08 to present' } },
      { kind: 'experience', company: 'Brightside Coffee', title: 'Marketing Coordinator', start: '2019-02', end: '2021-07', provenance: { source: 'resume', quote: 'Brightside Coffee — Marketing Coordinator — 2019-02 to 2021-07' } },
      { kind: 'education', institution: 'Google', credential: 'Google Ads Search Certification', provenance: { source: 'resume', quote: 'Google Ads Search Certification (2022)' } },
      { kind: 'skill', name: 'Paid acquisition', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Scaled paid acquisition from $40k to $310k/mo at flat CAC' } },
      { kind: 'skill', name: 'A/B testing', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'A/B tested onboarding emails; +23% activation' } },
      { kind: 'skill', name: 'BigQuery', evidence: 'demonstrated', provenance: { source: 'resume', quote: 'Built the attribution model in BigQuery with the data team' } },
    ],
  },
];

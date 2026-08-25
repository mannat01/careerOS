import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { ReactNode } from 'react';
import RootPage from '../../app/page';
import SignInPage from '../../app/(auth)/sign-in/page';
import AuthLayout from '../../app/(auth)/layout';
import { ExtractionReview, OnboardingImportClient } from '../../app/onboarding/OnboardingImportClient';
import { AutonomyReview } from '../../app/onboarding/AutonomyReview';
import { briefingLatestResponseSchema, decisionSupportResponseSchema, defaultUserSettings } from '@careeros/contracts';
import { POPULATED_IMPORT, THIN_IMPORT } from '../../app/onboarding/onboarding-fixtures';
import { CareerStateReview } from '../../app/onboarding/CareerStateReflectBack';
import { NO_SIGNAL_STATE, POPULATED_STATE, STATE_EXPLANATIONS } from '../../app/onboarding/state-fixtures';
import { TodayRoomClient } from '../../app/(app)/today/TodayRoomClient';
import { OpportunitiesClient } from '../../app/(app)/opportunities/OpportunitiesClient';
import { OpportunityDetailClient } from '../../app/(app)/opportunities/OpportunityDetailClient';
import {
  EMPTY_OPPORTUNITIES,
  MATCH_BY_OPPORTUNITY,
  POPULATED_MATCH,
  POPULATED_OPPORTUNITIES,
  POPULATED_OPPORTUNITY_DETAIL,
} from '../../app/(app)/opportunities/opportunity-fixtures';
import { EMPTY_PIPELINE, POPULATED_PIPELINE, SAVED_APPLICATION_DETAIL } from '../../app/(app)/pipeline/pipeline-fixtures';
import { PipelineBoardClient } from '../../app/(app)/pipeline/PipelineBoardClient';
import { PlanRoomClient } from '../../app/(app)/plan/PlanRoomClient';
import { POPULATED_PLAN, THIN_PLAN } from '../../app/(app)/plan/plan-fixtures';
import { ResumeStudioClient } from '../../app/(app)/you/ResumeStudioClient';
import { BASE_RESUME, GROUNDED_VARIANT, RESUME_OPPORTUNITY, RESUME_PIPELINE, THIN_VARIANT } from '../../app/(app)/you/resume-fixtures';
import { ApprovalsRoomClient } from '../../app/(app)/approvals/ApprovalsRoomClient';
import { TrustKitClient } from '../../app/(app)/%5Fdev/trust/TrustKitClient';
import { InterviewPrepRoomClient } from '../../app/(app)/opportunities/interview-prep/InterviewPrepRoomClient';
import { GROUNDED_INTERVIEW_PREP, INTERVIEW_OPPORTUNITY, INTERVIEW_PIPELINE, THIN_INTERVIEW_PREP } from '../../app/(app)/opportunities/interview-prep/interview-prep-fixtures';
import { DraftsRoomClient } from '../../app/(app)/opportunities/drafts/DraftsRoomClient';
import { DRAFT_OPPORTUNITY, DRAFT_PIPELINE, GROUNDED_DRAFT, THIN_DRAFT } from '../../app/(app)/opportunities/drafts/draft-fixtures';
import { SkillsRoomClient } from '../../app/(app)/plan/skills/SkillsRoomClient';
import { EMPTY_SKILL_GAPS, INSUFFICIENT_SKILL_GAPS, POPULATED_SKILL_GAPS, SCOPED_SKILL_GAPS, SKILLS_OPPORTUNITY, SKILLS_PIPELINE } from '../../app/(app)/plan/skills/skills-fixtures';
import { DashboardsRoomClient } from '../../app/(app)/plan/dashboards/DashboardsRoomClient';
import { CAREER_MOMENTUM_DETAIL, POPULATED_DASHBOARD, THIN_DASHBOARD, detailFor } from '../../app/(app)/plan/dashboards/dashboard-fixtures';
import { PortfolioRoomClient } from '../../app/(app)/you/portfolio/PortfolioRoomClient';
import { GROUNDED_PORTFOLIO, INSUFFICIENT_PORTFOLIO, PUBLIC_PORTFOLIO, PUBLISH_GRANT, PUBLISHED_PORTFOLIO, UPDATED_PORTFOLIO } from '../../app/(app)/you/portfolio/portfolio-fixtures';
import { CalibrationRoomClient } from '../../app/(app)/plan/calibration/CalibrationRoomClient';
import { INSUFFICIENT_CALIBRATION, MEASURED_CALIBRATION } from '../../app/(app)/plan/calibration/calibration-fixtures';
import { PkmRoomClient } from '../../app/(app)/you/pkm/PkmRoomClient';
import { CREATED_PKM_ENTRY, DELETED_PKM_ENTRY, EMPTY_PKM, PKM_ENTRY, POPULATED_PKM, UPDATED_PKM_ENTRY } from '../../app/(app)/you/pkm/pkm-fixtures';
import { AppShell } from '../shell';
import { RoutingRecovery } from '../auth';
import { ApiError } from '../api/errors';
import { ApprovalDialog } from '../trust';
import { successFixtures } from '../test/msw/fixtures';

let pathname = '/today';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));

afterEach(cleanup);
const ONBOARDING_SETTINGS = defaultUserSettings(
  '00000000-0000-4000-8000-000000000001',
  '2026-08-11T12:00:00.000Z',
);

const routes: ReadonlyArray<{ name: string; path: string; renderRoute: () => ReactNode }> = [
  { name: 'Marketing/root', path: '/', renderRoute: () => <RootPage /> },
  { name: 'Sign-in', path: '/sign-in', renderRoute: () => <AuthLayout><SignInPage /></AuthLayout> },
  { name: 'Onboarding import', path: '/onboarding', renderRoute: () => <OnboardingImportClient initialSettings={ONBOARDING_SETTINGS} importResume={() => Promise.resolve(POPULATED_IMPORT)} /> },
  { name: 'Onboarding extraction review', path: '/onboarding', renderRoute: () => <ExtractionReview result={POPULATED_IMPORT} onBack={() => undefined} /> },
  { name: 'Onboarding thin extraction', path: '/onboarding', renderRoute: () => <ExtractionReview result={THIN_IMPORT} onBack={() => undefined} /> },
  { name: 'Onboarding reflect-back', path: '/onboarding', renderRoute: () => <CareerStateReview model={POPULATED_STATE} explanations={STATE_EXPLANATIONS} onCorrect={() => Promise.resolve(true)} /> },
  { name: 'Onboarding reflect-back no-signal', path: '/onboarding', renderRoute: () => <CareerStateReview model={NO_SIGNAL_STATE} explanations={STATE_EXPLANATIONS} /> },
  { name: 'Onboarding reflect-back correction', path: '/onboarding', renderRoute: () => <CareerStateReview model={NO_SIGNAL_STATE} explanations={STATE_EXPLANATIONS} importedFacts={POPULATED_IMPORT.entities} corrections={[{ id: '00000000-0000-4000-8000-000000000102', kind: 'skill', label: 'PostgreSQL', detail: 'intermediate', provenance: 'user' }]} onCorrect={() => Promise.resolve(true)} /> },
  { name: 'Onboarding autonomy review', path: '/onboarding', renderRoute: () => <AutonomyReview initialSettings={ONBOARDING_SETTINGS} dependencies={{ updateSettings: () => Promise.resolve(ONBOARDING_SETTINGS), completeOnboarding: () => Promise.reject(new Error('not exercised by static axe')), goToToday: () => undefined }} /> },
  { name: 'Routing dependency recovery', path: '/today', renderRoute: () => <RoutingRecovery error={new ApiError({ code: 'internal', message: 'Dependency unavailable.', traceId: 'axe-trace' })} retryHref="/today" /> },
  { name: 'Today', path: '/today', renderRoute: () => <AppShell><section aria-labelledby="today-axe-heading"><h1 id="today-axe-heading">Today</h1><TodayRoomClient dependencies={{ pendingApprovals: () => Promise.resolve(successFixtures.pendingApprovals()), latestBriefing: () => Promise.resolve(briefingLatestResponseSchema.parse({ ...successFixtures.briefing(), items: [{ ...successFixtures.briefing().items[0], kind: 'focus', autonomyTier: 'green', payload: { recommendation: 'Review the grounded role.', confidence: 0.82, evidenceRefs: ['experience:1'], modelVersion: 'reasoner@fake' } }] })), applications: () => Promise.resolve(POPULATED_PIPELINE) }} /></section></AppShell> },
  { name: 'Opportunities', path: '/opportunities', renderRoute: () => <AppShell><OpportunitiesClient dependencies={{ list: () => Promise.resolve(POPULATED_OPPORTUNITIES), match: (id) => Promise.resolve(MATCH_BY_OPPORTUNITY[id] ?? POPULATED_MATCH) }} /></AppShell> },
  { name: 'Pipeline', path: '/opportunities/pipeline', renderRoute: () => <AppShell><PipelineBoardClient dependencies={{ list: () => Promise.resolve(EMPTY_PIPELINE), patch: () => Promise.reject(new Error('Empty pipeline never patches.')) }} /></AppShell> },
  { name: 'Interview prep', path: '/opportunities/interview-prep', renderRoute: () => <AppShell><section aria-labelledby="interview-prep-axe-heading"><h1 id="interview-prep-axe-heading">Interview prep</h1><InterviewPrepRoomClient dependencies={{ listApplications: () => Promise.resolve(INTERVIEW_PIPELINE), getOpportunity: () => Promise.resolve(INTERVIEW_OPPORTUNITY), prepare: () => Promise.resolve(GROUNDED_INTERVIEW_PREP) }} /></section></AppShell> },
  { name: 'Drafts', path: '/opportunities/drafts', renderRoute: () => <AppShell><section aria-labelledby="drafts-axe-heading"><h1 id="drafts-axe-heading">Drafts</h1><DraftsRoomClient dependencies={{ listApplications: () => Promise.resolve(DRAFT_PIPELINE), getOpportunity: () => Promise.resolve(DRAFT_OPPORTUNITY), generate: () => Promise.resolve(GROUNDED_DRAFT), copyText: () => Promise.resolve() }} /></section></AppShell> },
  { name: 'Plan', path: '/plan', renderRoute: () => <AppShell><section aria-labelledby="plan-axe-heading"><h1 id="plan-axe-heading">Plan</h1><PlanRoomClient dependencies={{ getPlans: () => Promise.resolve(POPULATED_PLAN) }} /></section></AppShell> },
  { name: 'Skills', path: '/plan/skills', renderRoute: () => <AppShell><section aria-labelledby="skills-axe-heading"><h1 id="skills-axe-heading">Skills</h1><SkillsRoomClient dependencies={{ listApplications: () => Promise.resolve(SKILLS_PIPELINE), getOpportunity: () => Promise.resolve(SKILLS_OPPORTUNITY), getGaps: () => Promise.resolve(POPULATED_SKILL_GAPS) }} /></section></AppShell> },
  { name: 'You', path: '/you', renderRoute: () => <AppShell><section aria-labelledby="you-heading" className="flex flex-col gap-4"><h1 id="you-heading">You</h1><ResumeStudioClient dependencies={{ getBase: () => Promise.resolve(BASE_RESUME), listApplications: () => Promise.resolve(RESUME_PIPELINE), getOpportunity: () => Promise.resolve(RESUME_OPPORTUNITY), tailor: () => Promise.resolve(GROUNDED_VARIANT), getVariant: () => Promise.resolve(GROUNDED_VARIANT) }} /></section></AppShell> },
  { name: 'Portfolio', path: '/you/portfolio', renderRoute: () => <AppShell><section aria-labelledby="portfolio-axe-heading"><h1 id="portfolio-axe-heading">Portfolio</h1><PortfolioRoomClient dependencies={{ getOwner: () => Promise.resolve(GROUNDED_PORTFOLIO), generate: () => Promise.resolve(UPDATED_PORTFOLIO), mintPublishToken: () => Promise.resolve(PUBLISH_GRANT), publish: () => Promise.resolve(PUBLISHED_PORTFOLIO), getPublic: () => Promise.resolve(PUBLIC_PORTFOLIO) }} /></section></AppShell> },
  { name: 'Personal knowledge', path: '/you/pkm', renderRoute: () => <AppShell><section aria-labelledby="pkm-axe-heading"><h1 id="pkm-axe-heading">Personal knowledge</h1><PkmRoomClient dependencies={{ list: () => Promise.resolve(POPULATED_PKM), create: () => Promise.resolve(CREATED_PKM_ENTRY), update: () => Promise.resolve(UPDATED_PKM_ENTRY), delete: () => Promise.resolve(DELETED_PKM_ENTRY) }} /></section></AppShell> },
  { name: 'Approvals', path: '/approvals', renderRoute: () => <AppShell><section aria-labelledby="approvals-heading"><h1 id="approvals-heading">Approvals</h1><ApprovalsRoomClient dependencies={{ list: () => Promise.resolve(successFixtures.pendingApprovals()), mint: () => Promise.reject(new Error('not exercised by static axe')), edit: () => Promise.reject(new Error('not exercised by static axe')), execute: () => Promise.reject(new Error('not exercised by static axe')), deny: () => Promise.reject(new Error('not exercised by static axe')) }} /></section></AppShell> },
  { name: '/_dev/trust (development)', path: '/_dev/trust', renderRoute: () => <AppShell><TrustKitClient data={{ state: successFixtures.state(), opportunities: successFixtures.opportunities(), match: successFixtures.match(), audit: successFixtures.audit(), briefing: successFixtures.briefing() }} /></AppShell> },
];

describe('FM1 CI-BLOCKING ROUTE AXE MATRIX', () => {
  it.each(routes)('$name has zero axe violations (therefore zero serious/critical)', async ({ path, renderRoute }) => {
    pathname = path;
    const { container } = render(renderRoute());
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(routes)('$name preserves keyboard operation', async ({ path, renderRoute }) => {
    pathname = path;
    const { container } = render(renderRoute());
    const user = userEvent.setup();
    await user.tab();
    const hasKeyboardTarget = container.querySelector('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])') !== null;
    if (hasKeyboardTarget) expect(document.activeElement).not.toBe(document.body);
    else expect(document.activeElement).toBe(document.body);
  });

  it('FM3.1 populated opportunity list is axe-clean after matches load', async () => {
    pathname = '/opportunities';
    const { container } = render(
      <AppShell>
        <OpportunitiesClient dependencies={{
          list: () => Promise.resolve(POPULATED_OPPORTUNITIES),
          match: (id) => Promise.resolve(MATCH_BY_OPPORTUNITY[id] ?? POPULATED_MATCH),
        }} />
      </AppShell>,
    );
    await screen.findByRole('list', { name: 'Opportunity results' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM3.1 empty opportunity list is axe-clean', async () => {
    pathname = '/opportunities';
    const { container } = render(
      <AppShell>
        <OpportunitiesClient dependencies={{
          list: () => Promise.resolve(EMPTY_OPPORTUNITIES),
          match: () => Promise.reject(new Error('Empty list never requests a match.')),
        }} />
      </AppShell>,
    );
    await screen.findByRole('heading', { name: 'No opportunities found' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM3.1 populated opportunity detail and match is axe-clean', async () => {
    pathname = '/opportunities/opportunity-1';
    const { container } = render(
      <AppShell>
        <OpportunityDetailClient
          opportunityId="opportunity-1"
          dependencies={{
            get: () => Promise.resolve(POPULATED_OPPORTUNITY_DETAIL),
            match: () => Promise.resolve(POPULATED_MATCH),
            decide: () => Promise.resolve(decisionSupportResponseSchema.parse({
              alternatives: ['apply', 'wait'], evidenceRefs: ['experience:experience-1'],
              reasoning: 'Grounded evidence supports waiting.', confidence: 0.3,
              assumptions: ['The listed requirements are accurate.'], recommendation: 'wait',
              optionalityNote: 'Build the missing scope first.', modelVersion: 'strategic-reasoner@1.0.0',
            })),
            save: () => Promise.resolve(SAVED_APPLICATION_DETAIL),
          }}
        />
      </AppShell>,
    );
    await screen.findByRole('heading', { name: 'Why this fit' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM3.2 decision card is axe-clean and keyboard reachable', async () => {
    pathname = '/opportunities/opportunity-1';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <OpportunityDetailClient opportunityId="opportunity-1" dependencies={{
          get: () => Promise.resolve(POPULATED_OPPORTUNITY_DETAIL),
          match: () => Promise.resolve(POPULATED_MATCH),
          decide: () => Promise.resolve(decisionSupportResponseSchema.parse({
            alternatives: ['apply', 'wait'], evidenceRefs: ['experience:experience-1'],
            reasoning: 'Grounded evidence supports waiting.', confidence: 0.3,
            assumptions: ['The listed requirements are accurate.'], recommendation: 'wait',
            optionalityNote: 'Build the missing scope first.', modelVersion: 'strategic-reasoner@1.0.0',
          })),
          save: () => Promise.resolve(SAVED_APPLICATION_DETAIL),
        }} />
      </AppShell>,
    );
    const action = await screen.findByRole('button', { name: 'Should I apply?' });
    action.focus();
    await user.keyboard('{Enter}');
    const card = await screen.findByRole('region', { name: 'Should I apply decision support' });
    expect(card).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM3.3 populated pipeline board is axe-clean', async () => {
    pathname = '/opportunities/pipeline';
    const { container } = render(
      <AppShell>
        <PipelineBoardClient dependencies={{
          list: () => Promise.resolve(POPULATED_PIPELINE),
          patch: () => Promise.reject(new Error('Static axe board does not patch.')),
        }} />
      </AppShell>,
    );
    await screen.findByTestId('pipeline-board');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM3.3 empty pipeline is axe-clean', async () => {
    pathname = '/opportunities/pipeline';
    const { container } = render(
      <AppShell>
        <PipelineBoardClient dependencies={{
          list: () => Promise.resolve(EMPTY_PIPELINE),
          patch: () => Promise.reject(new Error('Empty pipeline never patches.')),
        }} />
      </AppShell>,
    );
    await screen.findByRole('heading', { name: 'Your pipeline is empty' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM3.3 applied confirmation is axe-clean and keyboard gated', async () => {
    pathname = '/opportunities/pipeline';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <PipelineBoardClient dependencies={{
          list: () => Promise.resolve(POPULATED_PIPELINE),
          patch: () => Promise.reject(new Error('Confirmation axe does not submit.')),
        }} />
      </AppShell>,
    );
    const card = await screen.findByTestId('pipeline-card-app-2');
    const open = within(card).getByRole('button', { name: 'I applied to this myself' });
    open.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Confirm your application' });
    expect(within(dialog).getByRole('button', { name: 'Confirm I applied' })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM4 full résumé tailor flow and ATS-check panel are axe-clean and keyboard reachable', async () => {
    pathname = '/you';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <ResumeStudioClient dependencies={{
          getBase: () => Promise.resolve(BASE_RESUME),
          listApplications: () => Promise.resolve(RESUME_PIPELINE),
          getOpportunity: () => Promise.resolve(RESUME_OPPORTUNITY),
          tailor: () => Promise.resolve(GROUNDED_VARIANT),
          getVariant: () => Promise.resolve(GROUNDED_VARIANT),
        }} />
      </AppShell>,
    );
    const action = await screen.findByRole('button', { name: 'Tailor résumé draft' });
    action.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('ats-check-panel')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM4 zero-grounded-bullet variant remains axe-clean', async () => {
    pathname = '/you';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <ResumeStudioClient dependencies={{
          getBase: () => Promise.resolve(BASE_RESUME),
          listApplications: () => Promise.resolve(RESUME_PIPELINE),
          getOpportunity: () => Promise.resolve(RESUME_OPPORTUNITY),
          tailor: () => Promise.resolve(THIN_VARIANT),
          getVariant: () => Promise.resolve(THIN_VARIANT),
        }} />
      </AppShell>,
    );
    await user.click(await screen.findByRole('button', { name: 'Tailor résumé draft' }));
    expect(await screen.findByRole('heading', { name: 'No grounded tailored content returned' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.1 full grounded interview-prep flow is axe-clean and keyboard reachable', async () => {
    pathname = '/opportunities/interview-prep';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <section aria-labelledby="interview-prep-flow-heading">
          <h1 id="interview-prep-flow-heading">Interview prep</h1>
          <InterviewPrepRoomClient dependencies={{
            listApplications: () => Promise.resolve(INTERVIEW_PIPELINE),
            getOpportunity: () => Promise.resolve(INTERVIEW_OPPORTUNITY),
            prepare: () => Promise.resolve(GROUNDED_INTERVIEW_PREP),
          }} />
        </section>
      </AppShell>,
    );
    const action = await screen.findByRole('button', { name: 'Generate practice questions' });
    action.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('grounded-interview-prep')).toBeVisible();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.1 thin interview-prep flow remains axe-clean', async () => {
    pathname = '/opportunities/interview-prep';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <section aria-labelledby="interview-prep-thin-heading">
          <h1 id="interview-prep-thin-heading">Interview prep</h1>
          <InterviewPrepRoomClient dependencies={{
            listApplications: () => Promise.resolve(INTERVIEW_PIPELINE),
            getOpportunity: () => Promise.resolve(INTERVIEW_OPPORTUNITY),
            prepare: () => Promise.resolve(THIN_INTERVIEW_PREP),
          }} />
        </section>
      </AppShell>,
    );
    await user.click(await screen.findByRole('button', { name: 'Generate practice questions' }));
    expect(await screen.findByRole('heading', { name: 'Not enough grounded interview material' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.3 grounded Drafts flow is axe-clean, keyboard reachable, and action-safe', async () => {
    pathname = '/opportunities/drafts';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <section aria-labelledby="drafts-grounded-heading">
          <h1 id="drafts-grounded-heading">Drafts</h1>
          <DraftsRoomClient dependencies={{
            listApplications: () => Promise.resolve(DRAFT_PIPELINE),
            getOpportunity: () => Promise.resolve(DRAFT_OPPORTUNITY),
            generate: () => Promise.resolve(GROUNDED_DRAFT),
            copyText: () => Promise.resolve(),
          }} />
        </section>
      </AppShell>,
    );
    const action = await screen.findByRole('button', { name: 'Generate draft' });
    action.focus();
    await user.keyboard('{Enter}');
    const draft = await screen.findByTestId('grounded-draft');
    expect(within(draft).getByRole('button', { name: 'Copy draft to clipboard' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /send|submit|approve/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.3 insufficient-data Drafts flow remains axe-clean without fabricated text', async () => {
    pathname = '/opportunities/drafts';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <section aria-labelledby="drafts-thin-heading">
          <h1 id="drafts-thin-heading">Drafts</h1>
          <DraftsRoomClient dependencies={{
            listApplications: () => Promise.resolve(DRAFT_PIPELINE),
            getOpportunity: () => Promise.resolve(DRAFT_OPPORTUNITY),
            generate: () => Promise.resolve(THIN_DRAFT),
            copyText: () => Promise.resolve(),
          }} />
        </section>
      </AppShell>,
    );
    await user.click(await screen.findByRole('button', { name: 'Generate draft' }));
    expect(await screen.findByRole('heading', { name: 'Not enough grounded evidence for a draft' })).toBeVisible();
    expect(screen.queryByTestId('grounded-draft')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.2 populated grounded Plan room is axe-clean and keyboard navigable', async () => {
    pathname = '/plan';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <section aria-labelledby="plan-populated-heading">
          <h1 id="plan-populated-heading">Plan</h1>
          <PlanRoomClient dependencies={{ getPlans: () => Promise.resolve(POPULATED_PLAN) }} />
        </section>
      </AppShell>,
    );
    const opportunities = await screen.findByRole('link', { name: 'Open Opportunities' });
    opportunities.focus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('link', { name: 'Open You' })).toHaveFocus();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.2 thin Plan room remains axe-clean', async () => {
    pathname = '/plan';
    const { container } = render(
      <AppShell>
        <section aria-labelledby="plan-thin-heading">
          <h1 id="plan-thin-heading">Plan</h1>
          <PlanRoomClient dependencies={{ getPlans: () => Promise.resolve(THIN_PLAN) }} />
        </section>
      </AppShell>,
    );
    expect(await screen.findByRole('heading', { name: 'Not enough grounded state for a plan' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.4 populated Skills room renders both grounded sources axe-clean and keyboard reachable', async () => {
    pathname = '/plan/skills';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <section aria-labelledby="skills-populated-heading">
          <h1 id="skills-populated-heading">Skills</h1>
          <SkillsRoomClient dependencies={{
            listApplications: () => Promise.resolve(SKILLS_PIPELINE),
            getOpportunity: () => Promise.resolve(SKILLS_OPPORTUNITY),
            getGaps: (query) => Promise.resolve(query.opportunityId ? SCOPED_SKILL_GAPS : POPULATED_SKILL_GAPS),
          }} />
        </section>
      </AppShell>,
    );
    const picker = await screen.findByRole('combobox', { name: 'Pipeline opportunity' });
    expect(screen.getByTestId('skill-gap-per_opp')).toHaveTextContent('Real role requirement');
    expect(screen.getByTestId('skill-gap-aggregate')).toHaveTextContent('Stated target role');
    picker.focus();
    await user.selectOptions(picker, SKILLS_OPPORTUNITY.id);
    expect(await screen.findByTestId('skill-gap-per_opp')).toBeVisible();
    expect(screen.queryByTestId('skill-gap-aggregate')).not.toBeInTheDocument();
    screen.getByRole('link', { name: 'Open You' }).focus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Open Plan' })).toHaveFocus();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate|send|submit|approve|execute/i })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.4 analyzed-empty Skills state is axe-clean and distinct from insufficient data', async () => {
    pathname = '/plan/skills';
    const { container } = render(
      <AppShell>
        <SkillsRoomClient dependencies={{
          listApplications: () => Promise.resolve(SKILLS_PIPELINE),
          getOpportunity: () => Promise.resolve(SKILLS_OPPORTUNITY),
          getGaps: () => Promise.resolve(EMPTY_SKILL_GAPS),
        }} />
      </AppShell>,
    );
    expect(await screen.findByRole('heading', { name: 'Analyzed — no gaps found' })).toBeVisible();
    expect(screen.queryByTestId('insufficient-data')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.4 insufficient-data Skills state is axe-clean without fabricated gaps', async () => {
    pathname = '/plan/skills';
    const { container } = render(
      <AppShell>
        <SkillsRoomClient dependencies={{
          listApplications: () => Promise.resolve(SKILLS_PIPELINE),
          getOpportunity: () => Promise.resolve(SKILLS_OPPORTUNITY),
          getGaps: () => Promise.resolve(INSUFFICIENT_SKILL_GAPS),
        }} />
      </AppShell>,
    );
    expect(await screen.findByRole('heading', { name: 'Not enough to analyze' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Grounded skill gaps' })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.5 populated Dashboards room and keyboard-opened resolved evidence are axe-clean', async () => {
    pathname = '/plan/dashboards';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <section aria-labelledby="dashboards-axe-heading">
          <h1 id="dashboards-axe-heading">Dashboards</h1>
          <DashboardsRoomClient dependencies={{
            list: () => Promise.resolve(POPULATED_DASHBOARD),
            detail: (metric) => Promise.resolve(metric === 'career_momentum'
              ? CAREER_MOMENTUM_DETAIL
              : detailFor(POPULATED_DASHBOARD.metrics.find((item) => item.metric === metric)!)),
          }} />
        </section>
      </AppShell>,
    );
    const card = await screen.findByTestId('metric-card-career_momentum');
    const detail = within(card).getByRole('button', { name: 'View resolved evidence for Career momentum' });
    detail.focus();
    await user.keyboard('{Enter}');
    expect(await within(card).findByRole('heading', { name: 'Resolved evidence' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.5 insufficient-data metric remains axe-clean and distinct from a real low score', async () => {
    pathname = '/plan/dashboards';
    const { container } = render(
      <AppShell>
        <DashboardsRoomClient dependencies={{
          list: () => Promise.resolve(THIN_DASHBOARD),
          detail: (metric) => Promise.resolve(detailFor(THIN_DASHBOARD.metrics.find((item) => item.metric === metric)!)),
        }} />
      </AppShell>,
    );
    expect(await screen.findByRole('heading', { name: 'Interview readiness: not enough signal yet' })).toBeVisible();
    expect(screen.getByTestId('metric-card-networking_strength')).toHaveTextContent('47');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.5 single-card typed recovery is axe-clean without removing the dashboard', async () => {
    pathname = '/plan/dashboards';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <DashboardsRoomClient dependencies={{
          list: () => Promise.resolve(POPULATED_DASHBOARD),
          detail: () => Promise.reject(new ApiError({ code: 'not_found', status: 404, message: 'Metric missing.' })),
        }} />
      </AppShell>,
    );
    const card = await screen.findByTestId('metric-card-career_momentum');
    await user.click(within(card).getByRole('button', { name: 'View resolved evidence for Career momentum' }));
    expect(await within(card).findByTestId('error-recovery')).toHaveAttribute('data-code', 'not_found');
    expect(screen.getByTestId('metric-card-skill_momentum')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.7 measured Calibration reliability tables and advisory links are axe-clean', async () => {
    pathname = '/plan/calibration';
    const { container } = render(
      <AppShell>
        <section aria-labelledby="calibration-measured-axe-heading">
          <h1 id="calibration-measured-axe-heading">Calibration</h1>
          <CalibrationRoomClient dependencies={{ getCalibration: () => Promise.resolve(MEASURED_CALIBRATION) }} />
        </section>
      </AppShell>,
    );
    expect(await screen.findByRole('table', { name: 'Overall reliability bins: parsed predicted-confidence and observed-accuracy values' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'apply reliability bins: parsed predicted-confidence and observed-accuracy values' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.7 insufficient-data Calibration is axe-clean without measured figures', async () => {
    pathname = '/plan/calibration';
    const { container } = render(
      <AppShell>
        <CalibrationRoomClient dependencies={{ getCalibration: () => Promise.resolve(INSUFFICIENT_CALIBRATION) }} />
      </AppShell>,
    );
    expect(await screen.findByText('not enough outcomes yet to measure calibration')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Expected calibration error')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.7 typed Calibration recovery remains axe-clean with retry and navigation', async () => {
    pathname = '/plan/calibration';
    const { container } = render(
      <AppShell>
        <CalibrationRoomClient dependencies={{
          getCalibration: () => Promise.reject(new ApiError({ code: 'internal', message: 'Calibration unavailable.', traceId: 'trace-calibration-axe' })),
        }} />
      </AppShell>,
    );
    expect(await screen.findByTestId('error-recovery')).toHaveAttribute('data-code', 'internal');
    expect(screen.getByRole('link', { name: 'Open Plan' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.6 grounded Portfolio and keyboard-opened exact public preview are axe-clean and explicit-confirmation gated', async () => {
    pathname = '/you/portfolio';
    const user = userEvent.setup();
    const publish = vi.fn(() => Promise.resolve(PUBLISHED_PORTFOLIO));
    const { container } = render(
      <AppShell>
        <section aria-labelledby="portfolio-grounded-axe-heading">
          <h1 id="portfolio-grounded-axe-heading">Portfolio</h1>
          <PortfolioRoomClient dependencies={{
            getOwner: () => Promise.resolve(GROUNDED_PORTFOLIO),
            generate: () => Promise.resolve(UPDATED_PORTFOLIO),
            mintPublishToken: () => Promise.resolve(PUBLISH_GRANT),
            publish,
            getPublic: () => Promise.resolve(PUBLIC_PORTFOLIO),
          }} />
        </section>
      </AppShell>,
    );
    const open = await screen.findByRole('button', { name: 'Publish' });
    open.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: "Here's exactly what will become public" });
    expect(within(dialog).getByRole('button', { name: 'Keep private' })).toHaveFocus();
    expect(dialog).toHaveTextContent('project:deploy-safety');
    expect(publish).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.6 insufficient-data Portfolio is axe-clean and unpublishable', async () => {
    pathname = '/you/portfolio';
    const mintPublishToken = vi.fn(() => Promise.reject(new Error('must not mint')));
    const { container } = render(
      <AppShell>
        <PortfolioRoomClient dependencies={{
          getOwner: () => Promise.resolve(INSUFFICIENT_PORTFOLIO),
          generate: () => Promise.resolve(INSUFFICIENT_PORTFOLIO),
          mintPublishToken,
          publish: () => Promise.reject(new Error('must not publish')),
          getPublic: () => Promise.reject(new ApiError({ code: 'not_found', status: 404, message: 'Not published.' })),
        }} />
      </AppShell>,
    );
    expect(await screen.findByRole('heading', { name: 'Portfolio draft: not enough grounded data' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(mintPublishToken).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.6 publish mismatch and public-only boundary recoveries are axe-clean', async () => {
    pathname = '/you/portfolio';
    const user = userEvent.setup();
    const getOwner = vi.fn().mockResolvedValueOnce(GROUNDED_PORTFOLIO).mockResolvedValue(UPDATED_PORTFOLIO);
    const publish = vi.fn(() => Promise.reject(new ApiError({
      code: 'capability_denied',
      status: 403,
      message: 'Portfolio content changed.',
      details: { action: 'portfolio.publish', reason: 'approval_payload_mismatch' },
    })));
    const getPublic = vi.fn(() => Promise.reject(new ApiError({ code: 'not_found', status: 404, message: 'Not published.' })));
    const { container } = render(
      <AppShell>
        <PortfolioRoomClient dependencies={{
          getOwner,
          generate: () => Promise.resolve(UPDATED_PORTFOLIO),
          mintPublishToken: () => Promise.resolve(PUBLISH_GRANT),
          publish,
          getPublic,
        }} />
      </AppShell>,
    );
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm publish' }));
    expect(await screen.findByRole('heading', { name: 'The draft changed — confirm it again' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check public view' }));
    const publicBoundary = await screen.findByTestId('public-not-published');
    expect(publicBoundary).toHaveTextContent('No owner draft or private profile data is shown here.');
    expect(publicBoundary).not.toHaveTextContent('Updated platform engineer');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.8 populated PKM create/edit and explicit Green delete confirmation are axe-clean', async () => {
    pathname = '/you/pkm';
    const user = userEvent.setup();
    const create = vi.fn(() => Promise.resolve(CREATED_PKM_ENTRY));
    const update = vi.fn(() => Promise.resolve(UPDATED_PKM_ENTRY));
    const del = vi.fn(() => Promise.resolve(DELETED_PKM_ENTRY));
    const { container } = render(
      <AppShell>
        <section aria-labelledby="pkm-interactive-axe-heading">
          <h1 id="pkm-interactive-axe-heading">Personal knowledge</h1>
          <PkmRoomClient dependencies={{ list: () => Promise.resolve(POPULATED_PKM), create, update, delete: del }} />
        </section>
      </AppShell>,
    );
    const card = await screen.findByTestId(`pkm-entry-${PKM_ENTRY.id}`);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('pkm-edit-form')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Cancel edit' }));

    const createForm = screen.getByTestId('pkm-create-form');
    await user.type(within(createForm).getByLabelText('Title'), 'Interview reflection');
    await user.type(within(createForm).getByLabelText('Body'), 'Ask for concrete examples.');
    await user.click(within(createForm).getByRole('button', { name: 'Create entry' }));
    expect(await screen.findByTestId(`pkm-entry-${CREATED_PKM_ENTRY.id}`)).toBeVisible();
    expect(create).toHaveBeenCalledWith({ title: 'Interview reflection', body: 'Ask for concrete examples.', tags: [] });

    await user.click(within(screen.getByTestId(`pkm-entry-${PKM_ENTRY.id}`)).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: "Delete this entry? This can't be undone." });
    expect(within(dialog).getByRole('button', { name: 'Keep entry' })).toHaveFocus();
    expect(del).not.toHaveBeenCalled();
    expect(screen.queryByTestId('approval-dialog')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.8 empty PKM is axe-clean with an honest create path', async () => {
    pathname = '/you/pkm';
    const { container } = render(
      <AppShell>
        <PkmRoomClient dependencies={{
          list: () => Promise.resolve(EMPTY_PKM),
          create: () => Promise.resolve(CREATED_PKM_ENTRY),
          update: () => Promise.resolve(UPDATED_PKM_ENTRY),
          delete: () => Promise.resolve(DELETED_PKM_ENTRY),
        }} />
      </AppShell>,
    );
    expect(await screen.findByText('No entries yet')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create entry' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM6.8 optimistic delete rollback and typed recovery are axe-clean', async () => {
    pathname = '/you/pkm';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <PkmRoomClient dependencies={{
          list: () => Promise.resolve(POPULATED_PKM),
          create: () => Promise.resolve(CREATED_PKM_ENTRY),
          update: () => Promise.resolve(UPDATED_PKM_ENTRY),
          delete: () => Promise.reject(new ApiError({ code: 'not_found', status: 404, message: 'PKM entry not found.' })),
        }} />
      </AppShell>,
    );
    await user.click(within(await screen.findByTestId(`pkm-entry-${PKM_ENTRY.id}`)).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete entry permanently' }));
    expect(await screen.findByTestId('error-recovery')).toHaveAttribute('data-code', 'not_found');
    expect(screen.getByTestId(`pkm-entry-${PKM_ENTRY.id}`)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reload entries' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM5.1 populated Approvals room and lifecycle dialog are axe-clean and keyboard reachable', async () => {
    pathname = '/approvals';
    const user = userEvent.setup();
    const { container } = render(
      <AppShell>
        <section aria-labelledby="approvals-fm51-heading">
          <h1 id="approvals-fm51-heading">Approvals</h1>
          <ApprovalsRoomClient dependencies={{
            list: () => Promise.resolve(successFixtures.pendingApprovals()),
            mint: () => Promise.reject(new Error('not exercised by axe')),
            edit: () => Promise.reject(new Error('not exercised by axe')),
            execute: () => Promise.reject(new Error('not exercised by axe')),
            deny: () => Promise.reject(new Error('not exercised by axe')),
          }} />
        </section>
      </AppShell>,
    );
    const review = await screen.findByRole('button', { name: 'Review approval' });
    review.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Review briefing.item.execute' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FM5.1 ambient Twin dialog is axe-clean and keyboard reachable', async () => {
    pathname = '/plan';
    const user = userEvent.setup();
    const { container } = render(<AppShell><PlanRoomClient dependencies={{ getPlans: () => Promise.resolve(POPULATED_PLAN) }} /></AppShell>);
    await screen.findByTestId('populated-plan');
    const openTwin = screen.getByRole('button', { name: 'Open Twin (Command K)' });
    openTwin.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Twin' })).toBeVisible();
    expect(screen.getByLabelText('Question')).toHaveFocus();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('completes the ApprovalDialog request/edit/re-request/approve flow keyboard-only', async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(<ApprovalDialog action="draft.send" payload={{ body: 'Original' }} tier="yellow" summary="Send the draft." onApprove={onApprove} onClose={() => undefined} mintToken={({ payloadHash }) => Promise.resolve(`token-${payloadHash}`)} />);

    await user.tab(); // Payload preview
    await user.tab(); // Cancel
    await user.tab(); // Request approval
    expect(screen.getByRole('button', { name: 'Request approval' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Approved for this payload')).toBeInTheDocument();

    screen.getByLabelText('Payload preview (editable)').focus();
    await user.keyboard(' edited');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();

    await user.tab(); // Cancel
    await user.tab(); // Re-request
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Approved for this payload')).toBeInTheDocument();
    await user.tab(); // Approve
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onApprove).toHaveBeenCalledOnce();
  });
});

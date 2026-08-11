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
import { decisionSupportResponseSchema, defaultUserSettings } from '@careeros/contracts';
import { POPULATED_IMPORT, THIN_IMPORT } from '../../app/onboarding/onboarding-fixtures';
import { CareerStateReview } from '../../app/onboarding/CareerStateReflectBack';
import { NO_SIGNAL_STATE, POPULATED_STATE, STATE_EXPLANATIONS } from '../../app/onboarding/state-fixtures';
import TodayPage from '../../app/(app)/today/page';
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
import PlanPage from '../../app/(app)/plan/page';
import YouPage from '../../app/(app)/you/page';
import ApprovalsPage from '../../app/(app)/approvals/page';
import { TrustKitClient } from '../../app/(app)/%5Fdev/trust/TrustKitClient';
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
  { name: 'Today', path: '/today', renderRoute: () => <AppShell><TodayPage /></AppShell> },
  { name: 'Opportunities', path: '/opportunities', renderRoute: () => <AppShell><OpportunitiesClient dependencies={{ list: () => Promise.resolve(POPULATED_OPPORTUNITIES), match: (id) => Promise.resolve(MATCH_BY_OPPORTUNITY[id] ?? POPULATED_MATCH) }} /></AppShell> },
  { name: 'Pipeline', path: '/opportunities/pipeline', renderRoute: () => <AppShell><PipelineBoardClient dependencies={{ list: () => Promise.resolve(EMPTY_PIPELINE), patch: () => Promise.reject(new Error('Empty pipeline never patches.')) }} /></AppShell> },
  { name: 'Plan', path: '/plan', renderRoute: () => <AppShell><PlanPage /></AppShell> },
  { name: 'You', path: '/you', renderRoute: () => <AppShell><YouPage /></AppShell> },
  { name: 'Approvals', path: '/approvals', renderRoute: () => <AppShell><ApprovalsPage /></AppShell> },
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
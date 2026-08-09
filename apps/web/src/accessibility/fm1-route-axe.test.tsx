import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { ReactNode } from 'react';
import RootPage from '../../app/page';
import SignInPage from '../../app/(auth)/sign-in/page';
import AuthLayout from '../../app/(auth)/layout';
import { OnboardingPlaceholder } from '../../app/onboarding/page';
import TodayPage from '../../app/(app)/today/page';
import OpportunitiesPage from '../../app/(app)/opportunities/page';
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

const routes: ReadonlyArray<{ name: string; path: string; renderRoute: () => ReactNode }> = [
  { name: 'Marketing/root', path: '/', renderRoute: () => <RootPage /> },
  { name: 'Sign-in', path: '/sign-in', renderRoute: () => <AuthLayout><SignInPage /></AuthLayout> },
  { name: 'Onboarding', path: '/onboarding', renderRoute: () => <OnboardingPlaceholder /> },
  { name: 'Routing dependency recovery', path: '/today', renderRoute: () => <RoutingRecovery error={new ApiError({ code: 'internal', message: 'Dependency unavailable.', traceId: 'axe-trace' })} retryHref="/today" /> },
  { name: 'Today', path: '/today', renderRoute: () => <AppShell><TodayPage /></AppShell> },
  { name: 'Opportunities', path: '/opportunities', renderRoute: () => <AppShell><OpportunitiesPage /></AppShell> },
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
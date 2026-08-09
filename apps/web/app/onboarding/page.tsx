import { redirect } from 'next/navigation';
import { actionForAuthenticatedRoute, evaluateCurrentAuthenticatedRoute, RoutingRecovery } from '@/auth';

/** Existing placeholder only. No onboarding content is implemented in Step 0. */
export function OnboardingPlaceholder(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold text-text-primary">
        Finish setting up
      </h1>
      <p className="text-text-secondary">
        Onboarding lands in the next batch. Once it&rsquo;s live, this
        step configures your goals, autonomy defaults, and quiet hours
        before the twin starts working on your behalf.
      </p>
      <p className="text-sm text-text-muted">
        FM1 scaffold — real onboarding UI arrives in FM2.
      </p>
    </main>
  );
}

/** `/onboarding` inverse guard: required renders; complete returns to Today. */
export default async function OnboardingPage(): Promise<JSX.Element> {
  const action = actionForAuthenticatedRoute(await evaluateCurrentAuthenticatedRoute(), 'onboarding');
  switch (action.kind) {
    case 'redirect': redirect(action.to);
    case 'render_onboarding': return <OnboardingPlaceholder />;
    case 'render_recovery': return <RoutingRecovery error={action.error} retryHref="/onboarding" />;
    case 'render_app': throw new Error('Onboarding guard cannot render the app shell.');
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
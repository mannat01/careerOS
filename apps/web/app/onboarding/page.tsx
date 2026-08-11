import { redirect } from 'next/navigation';
import { actionForAuthenticatedRoute, evaluateCurrentAuthenticatedRoute, RoutingRecovery } from '@/auth';
import { SessionProvider, type PublicSession } from '@/shell';
import { OnboardingImportClient } from './OnboardingImportClient';

/** `/onboarding` inverse guard: required renders; complete returns to Today. */
export default async function OnboardingPage(): Promise<JSX.Element> {
  const action = actionForAuthenticatedRoute(await evaluateCurrentAuthenticatedRoute(), 'onboarding');
  switch (action.kind) {
    case 'redirect': redirect(action.to);
    case 'render_onboarding': {
      const publicSession: PublicSession = { userId: action.me.user.id };
      return (
        <SessionProvider session={publicSession}>
          <OnboardingImportClient initialSettings={action.me.settings} />
        </SessionProvider>
      );
    }
    case 'render_recovery': return <RoutingRecovery error={action.error} retryHref="/onboarding" />;
    case 'render_app': throw new Error('Onboarding guard cannot render the app shell.');
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
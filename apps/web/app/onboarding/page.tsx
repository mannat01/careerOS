/**
 * `/onboarding` — FM1 stub.
 *
 * The (app) guard redirects users here when they're signed in but haven't
 * completed onboarding (per `/v1/me`). The real onboarding flow lands in
 * FM2; this placeholder just tells the user why they're here.
 */
export default function OnboardingPage(): JSX.Element {
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
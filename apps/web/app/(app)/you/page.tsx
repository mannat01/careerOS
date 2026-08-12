import { ResumeStudioClient } from './ResumeStudioClient';

/** You room — profile-derived materials and résumé studio. */
export default function YouPage(): JSX.Element {
  return (
    <section aria-labelledby="you-heading" className="flex flex-col gap-4">
      <h1 id="you-heading" className="text-2xl font-semibold text-text-primary">
        You
      </h1>
      <p className="text-text-secondary">Your profile-derived materials. Tailoring stays grounded and advisory.</p>
      <ResumeStudioClient />
    </section>
  );
}
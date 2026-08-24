import Link from 'next/link';
import { ResumeStudioClient } from './ResumeStudioClient';

/** You room — profile-derived materials and résumé studio. */
export default function YouPage(): JSX.Element {
  return (
    <section aria-labelledby="you-heading" className="flex flex-col gap-4">
      <h1 id="you-heading" className="text-2xl font-semibold text-text-primary">
        You
      </h1>
      <p className="text-text-secondary">Your profile-derived materials. Tailoring stays grounded and advisory.</p>
      <nav aria-label="You material rooms" className="flex flex-wrap gap-4 text-sm font-semibold">
        <Link href="/you/portfolio" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Portfolio</Link>
      </nav>
      <ResumeStudioClient />
    </section>
  );
}
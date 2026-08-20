import { PlanRoomClient } from './PlanRoomClient';
import Link from 'next/link';

/** Strategy Plan room — grounded, advisory plans from GET /v1/cie/plans. */
export default function PlanPage(): JSX.Element {
  return (
    <section aria-labelledby="plan-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="plan-heading" className="text-2xl font-semibold text-text-primary">Plan</h1>
        <p className="mt-1 text-text-secondary">Grounded next actions and milestones traced to your real goals, profile, and pipeline.</p>
        <Link href="/plan/skills" className="mt-3 inline-flex text-sm font-semibold text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Skills analysis</Link>
      </header>
      <PlanRoomClient />
    </section>
  );
}
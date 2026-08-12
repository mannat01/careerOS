import { TodayRoomClient } from './TodayRoomClient';

/** Today room — read-only aggregation over approvals, briefings, and applications. */
export default function TodayPage() {
  return (
    <section className="flex flex-col gap-5" aria-labelledby="today-heading">
      <h1 id="today-heading" className="text-2xl font-semibold text-text-primary">Today</h1>
      <p className="text-text-secondary">
        A read-only view of what already exists across CareerOS. Review and execute actions in their own rooms.
      </p>
      <TodayRoomClient />
    </section>
  );
}
import { DashboardsRoomClient } from './DashboardsRoomClient';

/** Nested Plan feature room — scored, advisory intelligence dashboards. */
export default function DashboardsPage(): JSX.Element {
  return (
    <section aria-labelledby="dashboards-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="dashboards-heading" className="text-2xl font-semibold text-text-primary">Dashboards</h1>
        <p className="mt-1 text-text-secondary">Inspect backend-scored career metrics and the resolved evidence behind them.</p>
      </header>
      <DashboardsRoomClient />
    </section>
  );
}
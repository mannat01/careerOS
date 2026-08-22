import { ListSkeleton } from '@/shell/state/Skeleton';

export default function DashboardsLoading(): JSX.Element {
  return <ListSkeleton rows={10} label="Loading scored dashboard metrics…" testId="dashboards-route-loading" />;
}
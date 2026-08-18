import { ListSkeleton } from '@/shell/state/Skeleton';

export default function PlanLoading(): JSX.Element {
  return <ListSkeleton rows={3} label="Loading your grounded plan…" testId="plan-route-loading" />;
}
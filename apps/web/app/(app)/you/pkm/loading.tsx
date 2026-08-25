import { ListSkeleton } from '@/shell/state/Skeleton';

export default function PkmLoading(): JSX.Element {
  return <ListSkeleton rows={2} label="Loading your personal knowledge…" testId="pkm-route-loading" />;
}
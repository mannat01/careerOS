import { ListSkeleton } from '@/shell/state/Skeleton';

export default function OpportunitiesLoading(): JSX.Element {
  return <ListSkeleton rows={3} label="Loading opportunities and match explanations…" />;
}

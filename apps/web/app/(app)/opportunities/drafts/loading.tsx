import { RouteSkeleton } from '@/shell/state/Skeleton';

export default function DraftsLoading(): JSX.Element {
  return <RouteSkeleton label="Loading pipeline opportunities for drafts…" testId="drafts-route-loading" />;
}
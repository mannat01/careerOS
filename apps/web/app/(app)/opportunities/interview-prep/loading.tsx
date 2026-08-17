import { RouteSkeleton } from '@/shell/state/Skeleton';

export default function InterviewPrepLoading(): JSX.Element {
  return <RouteSkeleton label="Loading interview prep …" testId="interview-prep-route-loading" />;
}
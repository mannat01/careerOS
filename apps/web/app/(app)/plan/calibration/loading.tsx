import { ListSkeleton } from '@/shell/state/Skeleton';

export default function CalibrationLoading(): JSX.Element {
  return <ListSkeleton rows={3} label="Loading measured calibration…" testId="calibration-route-loading" />;
}
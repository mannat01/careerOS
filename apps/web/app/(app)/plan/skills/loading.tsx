import { RouteSkeleton } from '@/shell/state/Skeleton';

export default function SkillsLoading(): JSX.Element {
  return <RouteSkeleton label="Loading your grounded skills analysis…" testId="skills-route-loading" />;
}
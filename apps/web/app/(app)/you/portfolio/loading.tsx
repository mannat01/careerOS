import { RouteSkeleton } from '@/shell/state/Skeleton';

export default function PortfolioLoading(): JSX.Element {
  return <RouteSkeleton label="Loading your portfolio…" testId="portfolio-route-loading" />;
}
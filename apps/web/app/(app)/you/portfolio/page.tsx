import { PortfolioRoomClient } from './PortfolioRoomClient';

/** You feature room — grounded private draft and deliberate public publication. */
export default function PortfolioPage(): JSX.Element {
  return (
    <section aria-labelledby="portfolio-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="portfolio-heading" className="text-2xl font-semibold text-text-primary">Portfolio</h1>
        <p className="mt-1 text-text-secondary">Build from real profile facts, inspect every provenance reference, and choose exactly what becomes public.</p>
      </header>
      <PortfolioRoomClient />
    </section>
  );
}
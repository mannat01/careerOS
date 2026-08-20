import { DraftsRoomClient } from './DraftsRoomClient';

/** Nested Opportunities feature room — grounded, draft-only cover letters and outreach. */
export default function DraftsPage(): JSX.Element {
  return (
    <section aria-labelledby="drafts-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="drafts-heading" className="text-2xl font-semibold text-text-primary">Drafts</h1>
        <p className="mt-1 text-text-secondary">Create a grounded cover letter or outreach message for a real opportunity already in your pipeline.</p>
      </header>
      <DraftsRoomClient />
    </section>
  );
}
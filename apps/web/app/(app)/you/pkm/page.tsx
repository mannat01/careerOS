import { PkmRoomClient } from './PkmRoomClient';

/** You feature room — the caller's own user-authored personal knowledge. */
export default function PkmPage(): JSX.Element {
  return (
    <section aria-labelledby="pkm-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="pkm-heading" className="text-2xl font-semibold text-text-primary">Personal knowledge</h1>
        <p className="mt-1 text-text-secondary">Write and manage your own entries. CareerOS does not generate or rewrite this content.</p>
      </header>
      <PkmRoomClient />
    </section>
  );
}
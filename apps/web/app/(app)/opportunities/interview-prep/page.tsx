import { InterviewPrepRoomClient } from './InterviewPrepRoomClient';

/** Nested Opportunities feature room — grounded, advisory interview practice. */
export default function InterviewPrepPage(): JSX.Element {
  return (
    <section aria-labelledby="interview-prep-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="interview-prep-heading" className="text-2xl font-semibold text-text-primary">Interview prep</h1>
        <p className="mt-1 text-text-secondary">Practice against a role already in your pipeline, using only its real requirements and your real profile facts.</p>
      </header>
      <InterviewPrepRoomClient />
    </section>
  );
}
import { SkillsRoomClient } from './SkillsRoomClient';

/** Nested Plan feature room — grounded, advisory skills-gap analysis. */
export default function SkillsPage(): JSX.Element {
  return (
    <section aria-labelledby="skills-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="skills-heading" className="text-2xl font-semibold text-text-primary">Skills</h1>
        <p className="mt-1 text-text-secondary">See grounded gaps across your profile and pipeline, or focus on one saved opportunity.</p>
      </header>
      <SkillsRoomClient />
    </section>
  );
}
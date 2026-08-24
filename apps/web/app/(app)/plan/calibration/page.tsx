import { CalibrationRoomClient } from './CalibrationRoomClient';

/** Nested Plan transparency room — measured confidence calibration, read-only. */
export default function CalibrationPage(): JSX.Element {
  return (
    <section aria-labelledby="calibration-heading" className="flex flex-col gap-5">
      <header>
        <h1 id="calibration-heading" className="text-2xl font-semibold text-text-primary">Calibration</h1>
        <p className="mt-1 text-text-secondary">Inspect how the product&apos;s stated confidence matched observed outcomes.</p>
      </header>
      <CalibrationRoomClient />
    </section>
  );
}
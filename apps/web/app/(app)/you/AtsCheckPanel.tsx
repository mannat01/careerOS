import type { ResumeAtsCheck } from '@careeros/contracts';
import { InsufficientData } from '@/trust';

/** Parse-safety result returned by the résumé service; no client-side scoring. */
export function AtsCheckPanel({ check }: { readonly check: ResumeAtsCheck }): JSX.Element {
  return (
    <section
      aria-labelledby="ats-check-heading"
      data-testid="ats-check-panel"
      className="rounded-lg border border-border-subtle bg-bg-subtle p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="ats-check-heading" className="font-semibold text-text-primary">ATS parse-safety check</h3>
        <span
          className={`rounded-full border px-2 py-1 text-xs font-semibold ${check.passed ? 'border-tier-green text-tier-green' : 'border-tier-yellow text-tier-yellow'}`}
        >
          {check.passed ? 'Parse-safe' : 'Review warnings'}
        </span>
      </div>
      <p className="mt-2 text-sm text-text-secondary">
        This checks machine-readable structure. It does not promise ranking or selection.
      </p>
      {check.warnings.length > 0 ? (
        <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-text-primary" aria-label="ATS parse-safety warnings">
          {check.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : check.passed ? (
        <p className="mt-3 text-sm text-text-primary">No parse-safety warnings were returned.</p>
      ) : (
        <InsufficientData
          className="mt-3"
          heading="ATS details were not returned"
          reason="The check did not pass, but the service returned no warning details."
          next={[{ id: 'retry-ats', label: 'Tailor again later to re-run the check.' }]}
        />
      )}
    </section>
  );
}
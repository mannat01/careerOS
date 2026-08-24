'use client';

import {
  calibrationResponseSchema,
  type CalibrationBucket,
  type CalibrationResponse,
  type DomainCalibration,
} from '@careeros/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiError, apiClient, createApi } from '@/api';
import { ErrorRecoveryRenderer, ListSkeleton } from '@/shell/state';
import { InsufficientData } from '@/trust';

export interface CalibrationRoomDependencies {
  /** The only network capability available to Calibration: read measured outcomes. */
  readonly getCalibration: () => Promise<CalibrationResponse>;
}

type RoomState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: ApiError }
  | { readonly kind: 'ready'; readonly response: CalibrationResponse };

function productionDependencies(): CalibrationRoomDependencies {
  const calibration = createApi(apiClient()).calibration;
  return { getCalibration: () => calibration.get() };
}

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError ? cause : new ApiError({
    code: 'internal',
    message: cause instanceof Error ? cause.message : 'Calibration could not be loaded.',
  });
}

function formatComputedAt(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value));
}

export function CalibrationRoomClient({ dependencies }: { readonly dependencies?: CalibrationRoomDependencies }): JSX.Element {
  const [deps] = useState(() => dependencies ?? productionDependencies());
  const [state, setState] = useState<RoomState>({ kind: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const response = calibrationResponseSchema.parse(await deps.getCalibration());
      setState({ kind: 'ready', response });
    } catch (cause) {
      setState({ kind: 'error', error: asApiError(cause) });
    }
  }, [deps]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === 'loading') {
    return <ListSkeleton rows={3} label="Loading measured calibration…" testId="calibration-loading" />;
  }
  if (state.kind === 'error') {
    return (
      <div className="space-y-5">
        <section aria-labelledby="calibration-error-heading" className="space-y-3">
          <h2 id="calibration-error-heading" className="text-lg font-semibold text-text-primary">Calibration is temporarily unavailable</h2>
          <ErrorRecoveryRenderer error={state.error} onRetry={() => void load()} />
        </section>
        <AdvisoryLinks />
      </div>
    );
  }

  return state.response.status === 'measured'
    ? <MeasuredCalibration response={state.response} />
    : <InsufficientCalibration response={state.response} />;
}

function MeasuredCalibration({ response }: { readonly response: Extract<CalibrationResponse, { status: 'measured' }> }): JSX.Element {
  const { report, feedback } = response;
  return (
    <div className="space-y-6" data-testid="measured-calibration">
      <section aria-labelledby="calibration-summary-heading" className="rounded-lg border border-border-subtle bg-bg-surface p-5">
        <h2 id="calibration-summary-heading" className="text-lg font-semibold text-text-primary">Measured calibration</h2>
        <p className="mt-1 text-sm text-text-secondary">How stated confidence compared with observed outcomes in the parsed response.</p>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <Figure label="Outcome sample size" value={report.sampleSize} />
          <Figure label="Expected calibration error" value={report.expectedCalibrationError} />
          <Figure label="Calibration score" value={report.calibrationScore} />
        </dl>
      </section>

      <ReliabilityTable bins={report.bins} caption="Overall reliability bins" heading="Overall reliability" />

      <section aria-labelledby="domain-calibration-heading" className="space-y-4">
        <h2 id="domain-calibration-heading" className="text-lg font-semibold text-text-primary">Per-domain calibration</h2>
        <div className="grid gap-4">
          {report.domains.map((domain) => <DomainBreakdown key={domain.domain} domain={domain} />)}
        </div>
      </section>

      <section aria-labelledby="calibration-feedback-heading" className="rounded-lg border border-border-subtle bg-bg-surface p-5">
        <h2 id="calibration-feedback-heading" className="text-lg font-semibold text-text-primary">Feedback</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Figure label="Overall adjustment" value={feedback.overall} />
          {Object.entries(feedback.byDomain).map(([domain, adjustment]) => (
            <Figure key={domain} label={`${domain} adjustment`} value={adjustment} />
          ))}
        </dl>
      </section>

      <Provenance label="Measured by" modelVersion={report.modelVersion} computedAt={report.computedAt} />
      <AdvisoryLinks />
    </div>
  );
}

function InsufficientCalibration({ response }: { readonly response: Extract<CalibrationResponse, { status: 'insufficient_data' }> }): JSX.Element {
  return (
    <div className="space-y-5" data-testid="insufficient-calibration">
      <InsufficientData
        heading="Calibration cannot be measured yet"
        headingLevel={2}
        reason="not enough outcomes yet to measure calibration"
        next={[
          { id: 'opportunities', label: 'Continue recording real outcomes in Opportunities', href: '/opportunities' },
          { id: 'plan', label: 'Return to Plan', href: '/plan' },
        ]}
      />
      <Provenance label="Response provenance:" modelVersion={response.report.modelVersion} computedAt={response.report.computedAt} />
      <AdvisoryLinks />
    </div>
  );
}

function DomainBreakdown({ domain }: { readonly domain: DomainCalibration }): JSX.Element {
  const headingId = useId();
  return (
    <article aria-labelledby={headingId} className="rounded-lg border border-border-subtle bg-bg-surface p-5" data-testid={`calibration-domain-${domain.domain}`}>
      <h3 id={headingId} className="font-semibold text-text-primary">{domain.domain}</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
        <Figure label="Sample size" value={domain.sampleSize} />
        <Figure label="Expected calibration error" value={domain.expectedCalibrationError} />
        <Figure label="Calibration score" value={domain.calibrationScore} />
        <Figure label="Feedback adjustment" value={domain.feedbackAdjustment} />
      </dl>
      <ReliabilityTable bins={domain.bins} caption={`${domain.domain} reliability bins`} />
    </article>
  );
}

function ReliabilityTable({ bins, caption, heading }: { readonly bins: readonly CalibrationBucket[]; readonly caption: string; readonly heading?: string }): JSX.Element {
  return (
    <section aria-label={caption} className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-surface p-5">
      {heading ? <h2 className="text-lg font-semibold text-text-primary">{heading}</h2> : null}
      <table className="mt-3 w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}: parsed predicted-confidence and observed-accuracy values</caption>
        <thead>
          <tr className="border-b border-border-subtle text-text-secondary">
            <th scope="col" className="px-2 py-2 font-semibold">Confidence range</th>
            <th scope="col" className="px-2 py-2 font-semibold">Sample count</th>
            <th scope="col" className="px-2 py-2 font-semibold">Mean confidence</th>
            <th scope="col" className="px-2 py-2 font-semibold">Observed accuracy</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((bin) => (
            <tr key={`${String(bin.lower)}-${String(bin.upper)}`} className="border-b border-border-subtle last:border-0">
              <td className="px-2 py-2">{String(bin.lower)}–{String(bin.upper)}</td>
              <td className="px-2 py-2">{String(bin.count)}</td>
              <td className="px-2 py-2">{String(bin.meanConfidence)}</td>
              <td className="px-2 py-2">{String(bin.observedAccuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: string | number }): JSX.Element {
  return <div><dt className="font-semibold text-text-secondary">{label}</dt><dd className="mt-1 text-text-primary">{String(value)}</dd></div>;
}

function Provenance({ label, modelVersion, computedAt }: { readonly label: string; readonly modelVersion: string; readonly computedAt: string }): JSX.Element {
  return (
    <p className="text-xs text-text-muted" data-testid="calibration-provenance">
      {label} {modelVersion} · computed <time dateTime={computedAt}>{formatComputedAt(computedAt)}</time>
    </p>
  );
}

function AdvisoryLinks(): JSX.Element {
  return (
    <nav aria-label="Calibration advisory links" className="rounded-lg border border-border-subtle bg-bg-subtle p-4">
      <h2 className="text-sm font-semibold text-text-primary">Continue in the room where work happens</h2>
      <p className="mt-1 text-sm text-text-secondary">Calibration is advisory and executes no Green, Yellow, or Red action inline.</p>
      <ul className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
        <li><Link href="/plan" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Plan</Link></li>
        <li><Link href="/opportunities" className="text-brand-base underline focus-visible:ring-2 focus-visible:ring-brand-base">Open Opportunities</Link></li>
      </ul>
    </nav>
  );
}
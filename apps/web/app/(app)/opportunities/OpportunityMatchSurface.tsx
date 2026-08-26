'use client';

import type { OpportunityMatchOk, OpportunityMatchResponse } from '@careeros/contracts';
import { AiSurface, ConfidenceChip, InsufficientData, WhyPopover, bandFor, type Confidence, type Evidence } from '@/trust';

function humanize(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function evidenceFor(match: OpportunityMatchOk): Evidence[] {
  return match.evidenceRefs.map((ref) => ({
    id: ref,
    source: 'Your profile evidence',
    snippet: ref,
  }));
}

function confidenceFor(match: OpportunityMatchOk): Confidence {
  const value = match.overall / 100;
  return {
    value,
    band: bandFor(value),
    source: match.modelVersion ?? 'match-score',
  };
}

export function OpportunityMatchSurface({
  match,
  compact = false,
}: {
  readonly match: OpportunityMatchResponse;
  readonly compact?: boolean;
}): JSX.Element {
  // insufficient_data ARM — CareerOS could not assess fit for this role. Render the
  // honest "not enough of your profile" state: NO score, NO confidence chip, NO band
  // (a fit is a grounded rubric — we refuse to invent one, per the union contract).
  if (
    match.status === 'insufficient_data' ||
    match.explanation.trim().length === 0 ||
    match.subscores.length === 0
  ) {
    const reason =
      match.status === 'insufficient_data'
        ? match.reason
        : 'CareerOS does not have enough grounded match detail to show a fit score for this role.';
    return (
      <InsufficientData
        reason={`Not enough of your profile to assess fit for this role. ${reason}`}
        next={[
          { id: 'profile', label: 'Add more profile evidence', href: '/you' },
          { id: 'later', label: 'Check this role again after your profile changes' },
        ]}
      />
    );
  }

  const evidence = evidenceFor(match);
  const confidence = confidenceFor(match);

  return (
    <AiSurface
      evidence={evidence}
      confidence={confidence}
      label={`Grounded match for opportunity ${match.opportunityId}`}
      className="rounded-lg border border-border-subtle bg-bg-subtle p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className={compact ? 'text-lg text-text-primary' : 'text-3xl text-text-primary'}>
          {match.overall}% match
        </strong>
        <ConfidenceChip confidence={confidence} />
        <WhyPopover
          subject={{ kind: 'match', label: 'Why this fit' }}
          evidence={evidence}
          reasoning={match.explanation}
          triggerLabel="Why this fit"
        />
      </div>

      {compact ? null : (
        <>
          <section aria-labelledby="fit-gaps-heading" className="mt-4 rounded-md border border-border-subtle bg-bg-elevated p-3">
            <h3 id="fit-gaps-heading" className="font-semibold text-text-primary">Fit and gaps</h3>
            <p className="mt-1 text-sm text-text-secondary">{match.explanation}</p>
          </section>
          <h3 id="match-breakdown-heading" className="sr-only">Match score breakdown</h3>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2" aria-labelledby="match-breakdown-heading">
            {match.subscores.map((subscore) => (
              <div key={subscore.key} className="rounded-md border border-border-subtle bg-bg-elevated p-3">
                <dt className="text-sm text-text-secondary">{humanize(subscore.key)}</dt>
                <dd className="mt-1 text-xl font-semibold text-text-primary">{subscore.value}%</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </AiSurface>
  );
}

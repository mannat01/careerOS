'use client';

import type { OpportunityMatchResponse } from '@careeros/contracts';
import { AiSurface, ConfidenceChip, InsufficientData, WhyPopover, bandFor, type Confidence, type Evidence } from '@/trust';

function humanize(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function evidenceFor(match: OpportunityMatchResponse): Evidence[] {
  return match.evidenceRefs.map((ref) => ({
    id: ref,
    source: 'Your profile evidence',
    snippet: ref,
  }));
}

function confidenceFor(match: OpportunityMatchResponse): Confidence {
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
  const evidence = evidenceFor(match);
  const confidence = confidenceFor(match);
  const hasExplanation = match.explanation.trim().length > 0;
  const hasBreakdown = match.subscores.length > 0;

  if (!hasExplanation || !hasBreakdown) {
    return (
      <InsufficientData
        reason="CareerOS does not have enough grounded match detail to show a fit score for this role."
        next={[
          { id: 'profile', label: 'Add more profile evidence', href: '/you' },
          { id: 'later', label: 'Check this role again after your profile changes' },
        ]}
      />
    );
  }

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

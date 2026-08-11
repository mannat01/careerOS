'use client';

import type { DecisionSupportResponse } from '@careeros/contracts';
import {
  AiSurface,
  ConfidenceChip,
  InsufficientData,
  TierBadge,
  WhyPopover,
  bandFor,
  type Confidence,
  type Evidence,
} from '@/trust';

const BUILD_SIGNAL = [
  { id: 'profile', label: 'Add or confirm relevant profile evidence', href: '/you' },
  { id: 'later', label: 'Ask again when the opportunity or your profile changes' },
] as const;

function evidenceFor(decision: DecisionSupportResponse): Evidence[] {
  return decision.evidenceRefs.map((ref) => ({
    id: ref,
    source: 'Your profile or career-state evidence',
    snippet: ref,
  }));
}

function confidenceFor(decision: DecisionSupportResponse): Confidence {
  return {
    value: decision.confidence,
    band: bandFor(decision.confidence),
    source: decision.modelVersion ?? 'strategic-reasoner',
  };
}

function EmptyContractField({ field }: { readonly field: string }): JSX.Element {
  return (
    <InsufficientData
      heading={`No grounded ${field} returned`}
      reason={`The decision response did not contain grounded ${field}. CareerOS will not fill it in or infer a verdict.`}
      next={BUILD_SIGNAL}
    />
  );
}

/** Full evidence → reasoning → confidence → recommendation advisory contract. */
export function DecisionSupportCard({ decision }: { readonly decision: DecisionSupportResponse }): JSX.Element {
  const evidence = evidenceFor(decision);
  const confidence = confidenceFor(decision);
  const hasReasoning = decision.reasoning.trim().length > 0;
  const hasRecommendation = decision.recommendation.trim().length > 0;
  const hasOptionality = (decision.optionalityNote?.trim().length ?? 0) > 0;

  return (
    <AiSurface
      evidence={evidence}
      confidence={confidence}
      tier="green"
      label="Should I apply decision support"
      className="rounded-lg border border-border-subtle bg-bg-elevated p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Decision support</h3>
          <p className="mt-1 text-sm font-semibold text-text-primary">This is advice — you decide.</p>
          <p className="text-sm text-text-secondary">CareerOS will not apply, submit, or take any action from this card.</p>
        </div>
        <TierBadge tier="green" label="Green · advisory only" />
      </header>

      <div className="mt-5 space-y-5" data-testid="decision-contract">
        <section aria-labelledby="decision-alternatives-heading">
          <h4 id="decision-alternatives-heading" className="font-semibold text-text-primary">Alternatives considered</h4>
          {decision.alternatives.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
              {decision.alternatives.map((alternative, index) => <li key={`${String(index)}-${alternative}`}>{alternative}</li>)}
            </ul>
          ) : <div className="mt-2"><EmptyContractField field="alternatives" /></div>}
        </section>

        <section aria-labelledby="decision-evidence-heading">
          <div className="flex flex-wrap items-center gap-2">
            <h4 id="decision-evidence-heading" className="font-semibold text-text-primary">Evidence</h4>
            <WhyPopover
              subject={{ kind: 'decision', label: 'Decision evidence' }}
              evidence={evidence}
              reasoning={hasReasoning ? decision.reasoning : 'No grounded reasoning was returned.'}
              triggerLabel="Why this advice"
            />
          </div>
          {evidence.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm text-text-secondary">
              {evidence.map((item) => (
                <li key={item.id} className="rounded-md border border-border-subtle bg-bg-subtle p-3">
                  <span className="font-medium text-text-primary">{item.source}:</span> {item.snippet}
                </li>
              ))}
            </ul>
          ) : <div className="mt-2"><EmptyContractField field="evidence" /></div>}
        </section>

        <section aria-labelledby="decision-reasoning-heading">
          <h4 id="decision-reasoning-heading" className="font-semibold text-text-primary">Reasoning</h4>
          {hasReasoning
            ? <p className="mt-2 text-sm text-text-secondary">{decision.reasoning}</p>
            : <div className="mt-2"><EmptyContractField field="reasoning" /></div>}
        </section>

        <section aria-labelledby="decision-confidence-heading">
          <h4 id="decision-confidence-heading" className="font-semibold text-text-primary">Calibrated confidence</h4>
          <div className="mt-2"><ConfidenceChip confidence={confidence} /></div>
        </section>

        <section aria-labelledby="decision-assumptions-heading">
          <h4 id="decision-assumptions-heading" className="font-semibold text-text-primary">Assumptions</h4>
          {decision.assumptions.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
              {decision.assumptions.map((assumption, index) => <li key={`${String(index)}-${assumption}`}>{assumption}</li>)}
            </ul>
          ) : <div className="mt-2"><EmptyContractField field="assumptions" /></div>}
        </section>

        <section aria-labelledby="decision-recommendation-heading">
          <h4 id="decision-recommendation-heading" className="font-semibold text-text-primary">Recommendation</h4>
          {hasRecommendation
            ? <p className="mt-2 text-lg font-semibold text-text-primary" data-testid="decision-recommendation">{decision.recommendation}</p>
            : <div className="mt-2"><EmptyContractField field="recommendation" /></div>}
        </section>

        <section aria-labelledby="decision-optionality-heading">
          <h4 id="decision-optionality-heading" className="font-semibold text-text-primary">Optionality note</h4>
          {hasOptionality
            ? <p className="mt-2 text-sm text-text-secondary">{decision.optionalityNote}</p>
            : <div className="mt-2"><EmptyContractField field="optionality note" /></div>}
        </section>
      </div>
    </AiSurface>
  );
}
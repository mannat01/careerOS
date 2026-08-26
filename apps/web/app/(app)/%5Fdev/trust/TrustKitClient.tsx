'use client';

import type {
  AuditListResponse,
  BriefingLatestResponse,
  CieStateResponse,
  OpportunityListResponse,
  OpportunityMatchResponse,
} from '@careeros/contracts';
import { useState } from 'react';
import {
  AiSurface,
  ApprovalDialog,
  ConfidenceChip,
  InsufficientData,
  ProvenanceTag,
  TierBadge,
  WhyPopover,
  type Confidence,
  type Evidence,
} from '@/trust';
import { OpportunityMatchSurface } from '../../opportunities/OpportunityMatchSurface';

export interface TrustKitData {
  readonly state: CieStateResponse;
  readonly opportunities: OpportunityListResponse;
  readonly match: OpportunityMatchResponse;
  readonly audit: AuditListResponse;
  readonly briefing: BriefingLatestResponse;
}

const noSignalNext = [
  { id: 'profile', label: 'Add profile evidence', href: '/onboarding' },
  { id: 'goals', label: 'Tell CareerOS about your goals', href: '/you' },
] as const;

function evidenceFor(refs: readonly string[], source: string): Evidence[] {
  return refs.map((id) => ({ id, source, snippet: id }));
}

function confidence(value: number, source: string): Confidence {
  const band = value < 0.5 ? 'low' : value < 0.8 ? 'med' : 'high';
  return { value, band, source };
}

function dimensionLabel(dimension: string): string {
  return dimension.replaceAll('_', ' ');
}

export function TrustKitClient({ data }: { readonly data: TrustKitData }): JSX.Element {
  const [approvalOpen, setApprovalOpen] = useState(false);
  return <TrustKitContent data={data} approvalOpen={approvalOpen} setApprovalOpen={setApprovalOpen} />;
}

function TrustKitContent({
  data,
  approvalOpen,
  setApprovalOpen,
}: {
  readonly data: TrustKitData;
  readonly approvalOpen: boolean;
  readonly setApprovalOpen: (open: boolean) => void;
}): JSX.Element {
  const { state, opportunities, match, audit, briefing } = data;
  const yellowItem = briefing.items.find((item) => item.autonomyTier === 'yellow' && item.state === 'proposed');
  const noSignal = state.dimensions.filter((dimension) => dimension.provenance === 'no-signal');
  const populatedDimension = state.dimensions.find((dimension) => dimension.provenance !== 'no-signal');
  const opportunity = opportunities.data.find((item) => item.id === match.opportunityId);

  return (
    <section aria-labelledby="trust-kit-heading" className="mx-auto max-w-6xl space-y-8 p-6 text-text-primary">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">Development only</p>
        <h1 id="trust-kit-heading" className="mt-2 text-3xl font-semibold">Trust Kit kitchen sink</h1>
        <p className="mt-2 max-w-2xl text-text-secondary">Live backend responses parsed through @careeros/contracts. This page never mutates the seeded data.</p>
      </header>

      <section aria-labelledby="cie-heading" className="space-y-4">
        <h2 id="cie-heading" className="text-xl font-semibold">CIE state</h2>
        {populatedDimension ? (
          <AiSurface evidence={evidenceFor(populatedDimension.evidenceRefs, 'career state evidence ref')} confidence={confidence(populatedDimension.confidence, populatedDimension.modelVersion)} label={`Career state: ${dimensionLabel(populatedDimension.dimension)}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium capitalize">{dimensionLabel(populatedDimension.dimension)}</h3>
              <ConfidenceChip confidence={confidence(populatedDimension.confidence, populatedDimension.modelVersion)} />
              <ProvenanceTag provenance={populatedDimension.provenance === 'demonstrated' ? 'imported' : 'inferred_confirmed'} />
              <WhyPopover subject={{ kind: 'state', label: dimensionLabel(populatedDimension.dimension) }} evidence={evidenceFor(populatedDimension.evidenceRefs, 'career state evidence ref')} reasoning={`The state value is ${populatedDimension.provenance} and was refreshed at ${populatedDimension.freshnessAt}.`} />
            </div>
            <ul className="mt-3 list-disc pl-5 text-sm text-text-secondary">{populatedDimension.value.values.map((value) => <li key={value}>{value}</li>)}</ul>
          </AiSurface>
        ) : null}
        {noSignal.map((dimension) => {
          const noSignalConfidence = confidence(dimension.confidence, dimension.modelVersion);
          return (
            <AiSurface key={dimension.dimension} evidence={[]} confidence={noSignalConfidence} label={`Career state: ${dimensionLabel(dimension.dimension)}, no signal`}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="font-medium capitalize">{dimensionLabel(dimension.dimension)}</h3>
                <ConfidenceChip confidence={noSignalConfidence} showValue={false} />
                <ProvenanceTag provenance="no_signal" />
                <WhyPopover subject={{ kind: 'state', label: dimensionLabel(dimension.dimension) }} evidence={[]} reasoning="The live Career State Model has no supporting signal for this dimension yet." />
              </div>
              <InsufficientData heading="Not enough signal yet" reason="This dimension has no signal in the live Career State Model yet." next={noSignalNext} />
            </AiSurface>
          );
        })}
      </section>

      <section aria-labelledby="opportunity-heading" className="space-y-4">
        <h2 id="opportunity-heading" className="text-xl font-semibold">Populated opportunity match</h2>
        <p className="text-sm text-text-secondary">{opportunity?.company ?? 'Unknown company'} · {opportunity?.role ?? 'Unknown role'}</p>
        <OpportunityMatchSurface match={match} />
      </section>

      <section aria-labelledby="audit-heading" className="space-y-3">
        <h2 id="audit-heading" className="text-xl font-semibold">Audit evidence</h2>
        <ul className="space-y-2">{audit.data.map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle p-3"><TierBadge tier={entry.actor === 'twin' ? 'green' : 'yellow'} label={entry.actor === 'twin' ? 'Twin audit' : 'User/system audit'} /><span className="font-medium">{entry.action}</span><span className="text-sm text-text-secondary">{entry.reason}</span></li>)}</ul>
      </section>

      {yellowItem ? (
        <section aria-labelledby="briefing-heading" className="space-y-3">
          <h2 id="briefing-heading" className="text-xl font-semibold">Seeded Yellow briefing item</h2>
          <div className="rounded-lg border border-border-subtle p-4">
            <div className="flex flex-wrap items-center gap-2"><TierBadge tier="yellow" /><h3 className="font-medium">{typeof yellowItem.payload.title === 'string' ? yellowItem.payload.title : yellowItem.kind}</h3><span className="text-sm text-text-secondary">State: {yellowItem.state}</span></div>
            <p className="mt-2 text-sm text-text-secondary">{typeof yellowItem.payload.summary === 'string' ? yellowItem.payload.summary : 'Approval is required before this action can proceed.'}</p>
            <button type="button" className="mt-3 rounded-md border border-tier-yellow px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-brand-base" onClick={() => setApprovalOpen(true)}>Review approval</button>
          </div>
        </section>
      ) : null}

      {approvalOpen && yellowItem ? <ApprovalDialog action="briefing.item.execute" payload={yellowItem.payload} tier="yellow" summary="This seeded proposal remains proposed until you explicitly request approval." onApprove={() => setApprovalOpen(false)} onClose={() => setApprovalOpen(false)} mintToken={() => Promise.reject(new Error('Token minting is intentionally not wired on the read-only Trust Kit.'))} /> : null}
    </section>
  );
}

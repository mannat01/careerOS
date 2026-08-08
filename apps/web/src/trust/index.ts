/**
 * Trust Kit barrel — per `frontend-architecture.md §5`, the sanctioned
 * import path for every AI-produced surface is `apps/web/src/trust/`.
 * All Trust Kit components + shared types are re-exported here so
 * consumers get one canonical entry.
 */
export * from './types';
export * from './TierBadge';
export * from './ConfidenceChip';
export * from './ProvenanceTag';
export * from './WhyPopover';
export * from './InsufficientData';
export * from './AiSurface';
export * from './ApprovalDialog';
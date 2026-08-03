/**
 * Trust Kit barrel — per `frontend-architecture.md §5`, the sanctioned
 * import path for every AI-produced surface is `apps/web/src/trust/`.
 * All Trust Kit components + shared types are re-exported here so
 * consumers get one canonical entry.
 */
export * from './types.js';
export * from './TierBadge.js';
export * from './ConfidenceChip.js';
export * from './ProvenanceTag.js';
export * from './WhyPopover.js';
export * from './InsufficientData.js';
export * from './AiSurface.js';
export * from './ApprovalDialog.js';
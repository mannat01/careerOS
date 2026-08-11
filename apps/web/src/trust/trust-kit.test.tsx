/**
 * Trust Kit unit + a11y tests.
 *
 * Per FM1 Task 5 (`docs/frontend-milestone-01-workorder.md`) every trust
 * component must have:
 *   - unit tests covering all states,
 *   - keyboard + screen-reader assertions,
 *   - `vitest-axe` axe-clean assertions,
 *   - token-only styling (indirectly proven — no hex in the classes; the
 *     shared `tokens.contrast.test.ts` guards the palette).
 *
 * The dialog test *also* proves the load-bearing rule that
 * **editing the payload invalidates a prior approval token**.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

import { TierBadge } from './TierBadge';
import { ConfidenceChip } from './ConfidenceChip';
import { ProvenanceTag } from './ProvenanceTag';
import { WhyPopover } from './WhyPopover';
import { InsufficientData } from './InsufficientData';
import { AiSurface } from './AiSurface';
import { ApprovalDialog } from './ApprovalDialog';
import type { Confidence, Evidence, Provenance, Subject, Tier } from './types';

// A minimal "user" from testing-library — kept per-suite to keep timers sane.
function u(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup();
}

const CONFIDENCE_HIGH: Confidence = { value: 0.92, band: 'high', source: 'bayes-v2' };
const CONFIDENCE_LOW: Confidence = { value: 0.31, band: 'low', source: 'bayes-v2' };
const EVIDENCE_SAMPLE: Evidence[] = [
  { id: 'e1', source: 'resume', snippet: '5y of TypeScript' },
  { id: 'e2', source: 'job-posting', snippet: 'requires TS', url: 'https://example.test/job' },
];
const SUBJECT: Subject = { kind: 'score', label: 'Fit score' };

beforeEach(() => {
  cleanup();
});

// ---------- TierBadge ----------

describe('<TierBadge>', () => {
  it.each<[Tier, string]>([
    ['green', 'Green'],
    ['yellow', 'Yellow'],
    ['red', 'Red'],
  ])('renders tier=%s with icon + label + color', (tier, label) => {
    render(<TierBadge tier={tier} />);
    const badge = screen.getByTestId('tier-badge');
    expect(badge).toHaveAttribute('data-tier', tier);
    expect(badge).toHaveAttribute('aria-label', `Tier: ${label}`);
    // Label text is present (never color-only).
    expect(within(badge).getByTestId('tier-label')).toHaveTextContent(label);
    // Icon is aria-hidden (label carries meaning for AT).
    expect(within(badge).getByTestId('tier-icon')).toHaveAttribute('aria-hidden', 'true');
    // Uses the tier-* semantic token class (proves token-only styling wiring).
    expect(badge.className).toContain(`border-tier-${tier}`);
    expect(badge.className).toContain(`text-tier-${tier}`);
  });

  it('is not focusable by default; is focusable when interactive', () => {
    const { rerender } = render(<TierBadge tier="yellow" />);
    expect(screen.getByTestId('tier-badge')).not.toHaveAttribute('tabIndex');
    rerender(<TierBadge tier="yellow" interactive />);
    const badge = screen.getByTestId('tier-badge');
    expect(badge).toHaveAttribute('tabindex', '0');
    badge.focus();
    expect(document.activeElement).toBe(badge);
  });

  it('is axe-clean for every tier', async () => {
    const { container } = render(
      <>
        <TierBadge tier="green" />
        <TierBadge tier="yellow" />
        <TierBadge tier="red" />
      </>,
    );
     
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------- ConfidenceChip ----------

describe('<ConfidenceChip>', () => {
  it('renders band FIRST, then value, and links to calibration', () => {
    render(<ConfidenceChip confidence={CONFIDENCE_HIGH} />);
    const chip = screen.getByTestId('confidence-chip');
    expect(chip).toHaveAttribute('data-band', 'high');
    expect(chip).toHaveAttribute('href', '/you/calibration#bayes-v2');
    // Band label rendered before value in DOM order.
    const band = screen.getByTestId('confidence-band');
    const value = screen.getByTestId('confidence-value');
    expect(band).toHaveTextContent('High');
    expect(value).toHaveTextContent('92%');
     
    expect(band.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clamps out-of-range values instead of rendering NaN%', () => {
    render(
      <ConfidenceChip
        confidence={{ value: 1.7, band: 'high', source: 'bayes-v2' }}
      />,
    );
    expect(screen.getByTestId('confidence-value')).toHaveTextContent('100%');
  });

  it('is axe-clean across bands', async () => {
    const { container } = render(
      <>
        <ConfidenceChip confidence={CONFIDENCE_LOW} />
        <ConfidenceChip confidence={CONFIDENCE_HIGH} />
      </>,
    );
     
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------- ProvenanceTag ----------

describe('<ProvenanceTag>', () => {
  const cases: Array<[Provenance, string]> = [
    ['imported', 'Imported'],
    ['user', 'You added'],
    ['inferred_confirmed', 'AI — confirmed'],
    ['from_notes', 'From your notes'],
    ['no_signal', 'No signal yet'],
    ['demonstrated', 'Demonstrated'],
    ['inferred', 'Inferred by AI'],
    ['summarized', 'AI summary'],
  ];
  it.each(cases)('renders provenance=%s with label "%s"', (prov, label) => {
    render(<ProvenanceTag provenance={prov} />);
    const tag = screen.getByTestId('provenance-tag');
    expect(tag).toHaveAttribute('data-provenance', prov);
    expect(tag).toHaveAttribute('aria-label', `Provenance: ${label}`);
    expect(tag).toHaveTextContent(label);
  });

  it('is axe-clean for every provenance', async () => {
    const { container } = render(
      <>
        {cases.map(([p]) => (
          <ProvenanceTag key={p} provenance={p} />
        ))}
      </>,
    );
     
    expect(await axe(container)).toHaveNoViolations();
  });

  it('uses the AA text-secondary on bg-subtle pair for no-signal provenance', () => {
    render(<ProvenanceTag provenance="no_signal" />);
    const tag = screen.getByTestId('provenance-tag');
    expect(tag).toHaveClass('bg-bg-subtle', 'text-text-secondary');
    expect(tag).not.toHaveClass('text-text-muted');
  });
});

// ---------- WhyPopover ----------

describe('<WhyPopover>', () => {
  it('is closed by default; opens on click and moves focus into the dialog', async () => {
    const user = u();
    render(
      <WhyPopover subject={SUBJECT} evidence={EVIDENCE_SAMPLE} reasoning="High skill overlap." />,
    );
    const trigger = screen.getByTestId('why-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('why-popover')).toBeNull();

    await user.click(trigger);
    const popover = await screen.findByTestId('why-popover');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(popover).toHaveAttribute('role', 'dialog');
    expect(document.activeElement).toBe(popover);

    // Evidence rendered as a list, not a fake number.
    expect(screen.getByTestId('why-evidence-list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(EVIDENCE_SAMPLE.length);
  });

  it('shows "not enough signal yet" when evidence[] is empty (never a fake count)', async () => {
    const user = u();
    render(<WhyPopover subject={SUBJECT} evidence={[]} reasoning="No supporting evidence." />);
    await user.click(screen.getByTestId('why-trigger'));
    expect(screen.getByTestId('why-no-evidence')).toHaveTextContent('Not enough signal yet.');
  });

  it('Escape closes the popover and returns focus to the trigger', async () => {
    const user = u();
    render(
      <WhyPopover subject={SUBJECT} evidence={EVIDENCE_SAMPLE} reasoning="Match found." />,
    );
    const trigger = screen.getByTestId('why-trigger');
    await user.click(trigger);
    expect(await screen.findByTestId('why-popover')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('why-popover')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('is axe-clean when open', async () => {
    const user = u();
    const { container } = render(
      <WhyPopover subject={SUBJECT} evidence={EVIDENCE_SAMPLE} reasoning="Signals aligned." />,
    );
    await user.click(screen.getByTestId('why-trigger'));
     
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------- InsufficientData ----------

describe('<InsufficientData>', () => {
  it('renders reason + steps under a status role (polite, not alert)', () => {
    render(
      <InsufficientData
        reason="We need at least one saved role."
        next={[
          { id: 's1', label: 'Import your resume', href: '/settings/import' },
          { id: 's2', label: 'Save a first opportunity' },
        ]}
      />,
    );
    const region = screen.getByTestId('insufficient-data');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('insufficient-reason')).toHaveTextContent(
      'We need at least one saved role.',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('never renders a numeric score (anti-metric contract)', () => {
    render(
      <InsufficientData reason="No data yet." next={[{ id: 's', label: 'Do a thing' }]} />,
    );
    const region = screen.getByTestId('insufficient-data');
    // No stray digits should appear in the component's text.
    expect(region.textContent ?? '').not.toMatch(/\b\d+(?:\.\d+)?%?\b/);
  });

  it('uses the AA text-secondary on bg-subtle pair for its uppercase label', () => {
    render(
      <InsufficientData reason="No data yet." next={[{ id: 's', label: 'Do a thing' }]} />,
    );
    expect(screen.getByTestId('insufficient-data')).toHaveClass('bg-bg-subtle');
    const label = screen.getByTestId('insufficient-next-label');
    expect(label).toHaveClass('text-text-secondary');
    expect(label).not.toHaveClass('text-text-muted');
  });

  it('is axe-clean', async () => {
    const { container } = render(
      <InsufficientData
        reason="Not enough data."
        next={[{ id: 's', label: 'Do a thing' }]}
      />,
    );
     
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------- AiSurface ----------

describe('<AiSurface>', () => {
  it('renders with required evidence + confidence and exposes them as data attrs', () => {
    render(
      <AiSurface evidence={EVIDENCE_SAMPLE} confidence={CONFIDENCE_HIGH} tier="yellow">
        <span data-testid="child">payload</span>
      </AiSurface>,
    );
    const s = screen.getByTestId('ai-surface');
    expect(s).toHaveAttribute('data-evidence-count', String(EVIDENCE_SAMPLE.length));
    expect(s).toHaveAttribute('data-confidence-band', 'high');
    expect(s).toHaveAttribute('data-confidence-source', 'bayes-v2');
    expect(s).toHaveAttribute('data-tier', 'yellow');
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  /**
   * COMPILE-FAIL proof — same technique as apps/web/src/api/approval.test.ts.
   * The `@ts-expect-error` directives BELOW are the actual assertions:
   * TypeScript rejects each malformed call at compile time. If someone later
   * relaxes the `AiSurfaceProps` type so `evidence` or `confidence` become
   * optional, the corresponding directive becomes unused and the compile
   * fails with TS2578 — a positive, load-bearing guarantee.
   */
  it('COMPILE-FAIL: omitting evidence or confidence must not typecheck', () => {
     
    const _typeCheckOnly = (): JSX.Element => {
      return (
        <>
          {/* @ts-expect-error — evidence is required, cannot be omitted. */}
          <AiSurface confidence={CONFIDENCE_HIGH}>
            <span />
          </AiSurface>
          {/* @ts-expect-error — confidence is required, cannot be omitted. */}
          <AiSurface evidence={EVIDENCE_SAMPLE}>
            <span />
          </AiSurface>
          {/* @ts-expect-error — both required, cannot be omitted. */}
          <AiSurface>
            <span />
          </AiSurface>
        </>
      );
    };
    expect(typeof _typeCheckOnly).toBe('function');
  });

  it('is axe-clean', async () => {
    const { container } = render(
      <AiSurface evidence={EVIDENCE_SAMPLE} confidence={CONFIDENCE_HIGH} label="Fit score">
        <p>You are a strong match.</p>
      </AiSurface>,
    );
     
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------- ApprovalDialog ----------

describe('<ApprovalDialog>', () => {
  const basePayload = { to: 'recruiter@example.test', body: 'Hi there' };

  function mintFactory(): {
    mint: (args: { readonly action: string; readonly payloadHash: string }) => Promise<string>;
    calls: Array<{ readonly payloadHash: string }>;
  } {
    const calls: Array<{ readonly payloadHash: string }> = [];
    const mint = (args: {
      readonly action: string;
      readonly payloadHash: string;
    }): Promise<string> => {
      calls.push({ payloadHash: args.payloadHash });
      return Promise.resolve(`tok-${args.payloadHash}`);
    };
    return { mint, calls };
  }

  it('renders payload preview and tier; approve is disabled until token is minted', async () => {
    const user = u();
    const { mint } = mintFactory();
    const onApprove = vi.fn();
    render(
      <ApprovalDialog
        action="draft.send"
        payload={basePayload}
        tier="yellow"
        summary="Send drafted email to recruiter."
        onApprove={onApprove}
        onClose={() => {}}
        mintToken={mint}
      />,
    );

    const dialog = screen.getByTestId('approval-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-action', 'draft.send');
    // Tier badge visible.
    expect(screen.getByTestId('tier-badge')).toHaveAttribute('data-tier', 'yellow');

    const approve = screen.getByTestId('approval-approve');
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByTestId('approval-mint'));
    // After minting, approve enables and status flips.
    expect(await screen.findByText('Approved for this payload')).toBeInTheDocument();
    expect(screen.getByTestId('approval-approve')).toBeEnabled();

    await user.click(screen.getByTestId('approval-approve'));
    expect(onApprove).toHaveBeenCalledTimes(1);
    const [token, forwardedPayload] = onApprove.mock.calls[0] as [string, unknown];
    expect(token).toMatch(/^tok-/);
    expect(forwardedPayload).toEqual(basePayload);
  });

  /**
   * LOAD-BEARING: editing the payload after a mint MUST invalidate the token.
   * This is the whole point of hash-binding the approval.
   */
  it('editing the payload after mint invalidates the prior approval', async () => {
    const user = u();
    const { mint, calls } = mintFactory();
    const onApprove = vi.fn();
    render(
      <ApprovalDialog
        action="draft.send"
        payload={basePayload}
        tier="yellow"
        summary="Send drafted email to recruiter."
        onApprove={onApprove}
        onClose={() => {}}
        mintToken={mint}
      />,
    );

    // Mint an initial token.
    await user.click(screen.getByTestId('approval-mint'));
    expect(await screen.findByText('Approved for this payload')).toBeInTheDocument();
    expect(screen.getByTestId('approval-approve')).toBeEnabled();
    const hashAtMint = screen.getByTestId('approval-hash').textContent;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payloadHash).toBe(hashAtMint);

    // User edits the payload — token should invalidate immediately.
    const textarea = screen.getByTestId('approval-payload');
    fireEvent.change(textarea, {
      target: { value: JSON.stringify({ ...basePayload, body: 'EDITED' }, null, 2) },
    });
    expect(screen.getByText('Not yet approved')).toBeInTheDocument();
    expect(screen.getByTestId('approval-approve')).toBeDisabled();
    // Clicking approve now must NOT invoke the callback.
    await user.click(screen.getByTestId('approval-approve'));
    expect(onApprove).not.toHaveBeenCalled();

    // Re-mint after edit produces a DIFFERENT hash + token.
    await user.click(screen.getByTestId('approval-mint'));
    expect(await screen.findByText('Approved for this payload')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.payloadHash).not.toBe(hashAtMint);
  });

  it('ToS-gated denial renders honest "send it yourself" guidance and no approve button', () => {
    render(
      <ApprovalDialog
        action="draft.send"
        payload={basePayload}
        tier="yellow"
        summary="Send drafted message via LinkedIn."
         
        onApprove={() => {}}
        onClose={() => {}}
        mintToken={() => Promise.resolve('never-called')}
        denial={{
          reason: "LinkedIn's ToS forbids automated messaging.",
          manualSteps: ['Open LinkedIn', 'Paste the drafted message', 'Send yourself'],
        }}
      />,
    );
    expect(screen.getByTestId('approval-denial')).toBeInTheDocument();
    expect(screen.getByTestId('approval-denial-reason')).toHaveTextContent(
      "LinkedIn's ToS forbids automated messaging.",
    );
    expect(screen.queryByTestId('approval-approve')).toBeNull();
    expect(screen.queryByTestId('approval-mint')).toBeNull();
    // Steps rendered as ordered list.
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
  });

  it('is axe-clean in both editable and denied modes', async () => {
    const { container: editable } = render(
      <ApprovalDialog
        action="draft.send"
        payload={basePayload}
        tier="yellow"
        summary="Send drafted email."
         
        onApprove={() => {}}
        onClose={() => {}}
        mintToken={() => Promise.resolve('tok')}
      />,
    );
    expect(await axe(editable)).toHaveNoViolations();
    cleanup();

    const { container: denied } = render(
      <ApprovalDialog
        action="draft.send"
        payload={basePayload}
        tier="yellow"
        summary="Send drafted message via LinkedIn."
         
        onApprove={() => {}}
        onClose={() => {}}
        mintToken={() => Promise.resolve('tok')}
        denial={{ reason: 'ToS.', manualSteps: ['Do it yourself'] }}
      />,
    );
    expect(await axe(denied)).toHaveNoViolations();
  });
});
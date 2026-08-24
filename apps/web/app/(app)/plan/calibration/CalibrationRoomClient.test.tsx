import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api';
import {
  CalibrationRoomClient,
  type CalibrationRoomDependencies,
} from './CalibrationRoomClient';
import { INSUFFICIENT_CALIBRATION, MEASURED_CALIBRATION } from './calibration-fixtures';

afterEach(cleanup);

function dependencies(overrides: Partial<CalibrationRoomDependencies> = {}): CalibrationRoomDependencies {
  return {
    getCalibration: () => Promise.resolve(MEASURED_CALIBRATION),
    ...overrides,
  };
}

describe('FM6.7 Calibration room', () => {
  it('renders parsed measured bins, figures, domains, feedback, and provenance without AiSurface or confidence treatment', async () => {
    render(<CalibrationRoomClient dependencies={dependencies()} />);

    const measured = await screen.findByTestId('measured-calibration');
    const summaryHeading = within(measured).getByRole('heading', { name: 'Measured calibration' });
    const summary = summaryHeading.closest('section');
    if (!summary) throw new Error('Expected measured calibration summary section.');
    expect(within(summary).getByText('20')).toBeVisible();
    expect(within(summary).getByText('0.15')).toBeVisible();
    expect(within(summary).getByText('0.85')).toBeVisible();

    const overall = within(measured).getByRole('table', { name: 'Overall reliability bins: parsed predicted-confidence and observed-accuracy values' });
    const rows = within(overall).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('0.4–0.5');
    expect(rows[1]).toHaveTextContent('10');
    expect(rows[1]).toHaveTextContent('0.45');
    expect(rows[1]).toHaveTextContent('0.5');
    expect(rows[2]).toHaveTextContent('0.8–0.9');
    expect(rows[2]).toHaveTextContent('0.85');
    expect(rows[2]).toHaveTextContent('0.6');

    const apply = within(measured).getByTestId('calibration-domain-apply');
    expect(apply).toHaveTextContent('0.25');
    expect(apply).toHaveTextContent('0.75');
    expect(apply).toHaveTextContent('-0.29411764705882354');
    expect(within(apply).getByRole('table', { name: 'apply reliability bins: parsed predicted-confidence and observed-accuracy values' })).toBeVisible();

    expect(measured).toHaveTextContent('Overall adjustment');
    expect(measured).toHaveTextContent('-0.10160427807486633');
    expect(within(measured).getByTestId('calibration-provenance')).toHaveTextContent('calibration@fake-deterministic');
    expect(within(measured).getByTestId('calibration-provenance')).toHaveTextContent('Aug 24, 2026, 12:00 PM UTC');
    expect(within(measured).queryByTestId('ai-surface')).not.toBeInTheDocument();
    expect(within(measured).queryByTestId('confidence-chip')).not.toBeInTheDocument();
  });

  it('renders insufficient_data distinctly with the exact honest explanation and no reliability figures', async () => {
    render(<CalibrationRoomClient dependencies={dependencies({
      getCalibration: () => Promise.resolve(INSUFFICIENT_CALIBRATION),
    })} />);

    const insufficient = await screen.findByTestId('insufficient-calibration');
    expect(within(insufficient).getByTestId('insufficient-data')).toHaveTextContent('not enough outcomes yet to measure calibration');
    expect(within(insufficient).queryByTestId('measured-calibration')).not.toBeInTheDocument();
    expect(within(insufficient).queryByRole('table')).not.toBeInTheDocument();
    expect(within(insufficient).queryByText('Expected calibration error')).not.toBeInTheDocument();
    expect(within(insufficient).queryByText('Calibration score')).not.toBeInTheDocument();
    expect(within(insufficient).queryByText('Overall reliability')).not.toBeInTheDocument();
    expect(within(insufficient).getByTestId('calibration-provenance')).toHaveTextContent('calibration@fake-deterministic');
  });

  it('renders typed endpoint recovery and retries without a dead end', async () => {
    const getCalibration = vi
      .fn<CalibrationRoomDependencies['getCalibration']>()
      .mockRejectedValueOnce(new ApiError({
        code: 'rate_limited',
        status: 429,
        message: 'Calibration is temporarily rate limited.',
        details: { retryAfterSeconds: 1 },
        traceId: 'trace-calibration-room',
      }))
      .mockResolvedValueOnce(MEASURED_CALIBRATION);
    const user = userEvent.setup();
    render(<CalibrationRoomClient dependencies={{ getCalibration }} />);

    const recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'rate_limited');
    expect(screen.getByRole('link', { name: 'Open Plan' })).toBeVisible();
    await user.click(within(recovery).getByRole('button', { name: /retry/i }));
    expect(await screen.findByTestId('measured-calibration')).toBeVisible();
    expect(getCalibration).toHaveBeenCalledTimes(2);
  });

  it('fails typed on response-shape drift instead of rendering unparsed figures', async () => {
    const drifted = {
      ...MEASURED_CALIBRATION,
      report: { ...MEASURED_CALIBRATION.report, calibrationScore: 4 },
    } as unknown as typeof MEASURED_CALIBRATION;
    render(<CalibrationRoomClient dependencies={dependencies({
      getCalibration: () => Promise.resolve(drifted),
    })} />);

    const recovery = await screen.findByTestId('error-recovery');
    expect(recovery).toHaveAttribute('data-code', 'internal');
    expect(screen.queryByTestId('measured-calibration')).not.toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });

  it('is navigation-only and exposes no inline Green, Yellow, or Red execution', async () => {
    const deps = dependencies();
    render(<CalibrationRoomClient dependencies={deps} />);

    expect(await screen.findByText('Calibration is advisory and executes no Green, Yellow, or Red action inline.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Plan' })).toHaveAttribute('href', '/plan');
    expect(screen.getByRole('link', { name: 'Open Opportunities' })).toHaveAttribute('href', '/opportunities');
    expect(screen.queryByRole('button', { name: /generate|start|update|send|submit|approve|execute/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(Object.keys(deps)).toEqual(['getCalibration']);
  });
});
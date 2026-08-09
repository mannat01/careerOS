'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  openTwinStream,
  TwinStreamParseError,
  type TwinStreamEvent,
} from '../api';
import { ErrorRecoveryRenderer } from './state';

type TurnStatus = 'idle' | 'streaming' | 'complete' | 'approval_required' | 'error';

/**
 * The global Twin entry point. This remains a deliberately small FM1 surface:
 * one prompt, typed event telemetry, transcript, and the Yellow halt. History,
 * richer tools, and product workflows remain owned by later frontend FMs.
 */
export function TwinMount(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [events, setEvents] = useState<TwinStreamEvent[]>([]);
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<TurnStatus>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeStreamRef = useRef<ReturnType<typeof openTwinStream> | null>(null);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => {
    activeStreamRef.current?.close();
    activeStreamRef.current = null;
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openPalette();
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        closePalette();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closePalette, open, openPalette]);

  useEffect(() => () => activeStreamRef.current?.close(), []);

  async function submitTurn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || status === 'streaming') return;

    activeStreamRef.current?.close();
    const stream = openTwinStream(
      { prompt: message },
      { maxReconnects: 2 },
      // The same-origin reverse proxy avoids browser CORS creating a softer
      // auth path; its destination is still the canonical API /rt/twin route.
      { baseUrl: window.location.origin },
    );
    activeStreamRef.current = stream;
    setEvents([]);
    setAnswer('');
    setError(null);
    setStatus('streaming');

    try {
      for await (const item of stream) {
        if (item instanceof TwinStreamParseError) {
          throw new ApiError({
            code: 'internal',
            message: item.message,
            details: { rawFrame: item.rawFrame, zodIssues: item.zodIssues },
          });
        }
        setEvents((current) => [...current, item]);
        if (item.type === 'token') setAnswer((current) => current + item.text);
        if (item.type === 'approval_required') setStatus('approval_required');
        if (item.type === 'done') setStatus('complete');
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError({ code: 'internal', message: 'Twin turn failed.' }),
      );
      setStatus('error');
    } finally {
      activeStreamRef.current = null;
    }
  }

  return (
    <div data-testid="twin-mount">
      <button
        ref={buttonRef}
        type="button"
        onClick={openPalette}
        aria-label="Open Twin (Command K)"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-1.5 text-sm text-text-secondary transition-colors duration-fast hover:text-text-primary"
      >
        <span aria-hidden="true">⌘K</span>
        <span>Twin</span>
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-labelledby="twin-heading" className="fixed inset-0 z-40 flex items-start justify-center bg-bg-overlay p-4 pt-24">
          <div className="w-full max-w-xl rounded-lg border border-border-subtle bg-bg-elevated p-6 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="twin-heading" className="text-lg font-semibold text-text-primary">Twin</h2>
                <p className="text-sm text-text-secondary">Ask a grounded strategic question.</p>
              </div>
              <button type="button" onClick={closePalette} aria-label="Close Twin" className="rounded-md border border-border-subtle px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-brand-base">Close</button>
            </div>

            <form className="mt-4 space-y-3" onSubmit={(event) => void submitTurn(event)}>
              <label htmlFor="twin-prompt" className="block text-sm font-medium text-text-primary">Question</label>
              <textarea ref={inputRef} id="twin-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} required className="w-full rounded-md border border-border-subtle bg-bg-base p-3 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand-base" />
              <button type="submit" disabled={!prompt.trim() || status === 'streaming'} className="rounded-md bg-brand-base px-3 py-2 text-sm font-medium text-text-inverse disabled:opacity-60">
                {status === 'streaming' ? 'Thinking…' : 'Ask Twin'}
              </button>
            </form>

            <section aria-label="Twin turn" aria-live="polite" className="mt-4 space-y-3">
              <p data-testid="twin-status" className="text-xs font-semibold uppercase tracking-wide text-text-muted">{status.replace('_', ' ')}</p>
              {events.length > 0 ? (
                <ol aria-label="Twin event sequence" className="flex flex-wrap gap-2 text-xs">
                  {events.map((item, index) => <li key={`${item.type}-${String(index)}`} data-event-type={item.type} className="rounded border border-border-subtle px-2 py-1">{item.type}</li>)}
                </ol>
              ) : null}
              {answer ? <p data-testid="twin-answer" className="rounded-md bg-bg-subtle p-3 text-sm text-text-primary">{answer}</p> : null}
              {status === 'approval_required' ? (
                <div role="alert" data-testid="twin-approval-required" className="rounded-md border border-tier-yellow p-3 text-sm text-text-primary">Approval required. Twin stopped before execution. Review the action in Approvals.</div>
              ) : null}
              {error ? <ErrorRecoveryRenderer error={error} onRetry={() => setStatus('idle')} /> : null}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
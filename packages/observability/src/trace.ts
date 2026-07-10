import { randomBytes } from 'node:crypto';

/** W3C-style 16-byte trace id (hex). Used until real OTel context is wired. */
export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

// STUB(M01): stands in for OpenTelemetry SDK initialization (NodeSDK + OTLP exporter
// at OTEL_EXPORTER_OTLP_ENDPOINT, resource attrs, auto-instrumentation). Offline no-op,
// but the options are consumed (echoed back) so callers can assert their wiring —
// fixes the previously-unused `_opts` parameter instead of suppressing it.
export function initTracing(opts: { serviceName: string; endpoint?: string }): {
  enabled: boolean;
  serviceName: string;
} {
  // Real export only becomes possible once an endpoint is configured AND the OTel
  // SDK is wired (M02+); until then this stays disabled regardless.
  void opts.endpoint;
  return { enabled: false, serviceName: opts.serviceName };
}

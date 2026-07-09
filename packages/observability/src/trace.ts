import { randomBytes } from 'node:crypto';

/** W3C-style 16-byte trace id (hex). Used until real OTel context is wired. */
export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

// STUB(M01): stands in for OpenTelemetry SDK initialization (NodeSDK + OTLP exporter
// at OTEL_EXPORTER_OTLP_ENDPOINT, resource attrs, auto-instrumentation). No-op offline.
export function initTracing(_opts: { serviceName: string; endpoint?: string }): {
  enabled: boolean;
} {
  return { enabled: false };
}

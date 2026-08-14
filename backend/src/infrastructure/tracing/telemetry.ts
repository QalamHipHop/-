/**
 *  OpenTelemetry bootstrap. Lazy-loaded so unit tests can run without it.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

if (process.env.OTEL_DIAG === 'true') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

let started = false;

export function bootstrapTelemetry(): void {
  if (started) return;
  if (process.env.OTEL_ENABLED === 'false') return;
  started = true;

  const exporter = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OTLPTraceExporter({ url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` })
    : new ConsoleSpanExporter();

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'rial-backend',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION ?? '0.1.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? 'development',
    }),
    spanProcessor: new SimpleSpanProcessor(exporter),
    instrumentations: [getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    })],
  });

  try {
    sdk.start();
    const shutdown = (): void => { sdk.shutdown().catch(() => undefined); };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('OpenTelemetry failed to start:', err);
  }
}

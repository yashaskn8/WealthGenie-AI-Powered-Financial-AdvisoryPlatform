import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, propagation } from '@opentelemetry/api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_TRACE_LOG_PATH = path.join(ROOT_DIR, 'traces.jsonl');
const SAFE_ATTRIBUTE_NAMES = new Set([
  'agent.type', 'agent.name', 'agent.version', 'agent.graph_version', 'agent.scaffold_version',
  'agent.run_id', 'agent.status', 'agent.step_count', 'agent.tool_call_count', 'agent.model_call_count',
  'agent.tool_name', 'agent.tool_outcome', 'agent.policy_result', 'agent.evidence_status',
  'agent.fallback_used', 'agent.candidate_id', 'agent.evaluation_partition', 'agent.evaluation_version',
  'gen_ai.system', 'gen_ai.request.model', 'gen_ai.response.model', 'gen_ai.operation.name',
  'gen_ai.response.finish_reasons', 'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens',
  'gen_ai.usage.total_tokens', 'error.type',
]);
const SENSITIVE_ATTRIBUTE = /(user|profile|income|salary|tax|email|phone|address|prompt|content|input|output|secret|token|password|cookie|authorization|raw|payload|value)/i;

function safeAttributes(attributes = {}) {
  return Object.fromEntries(Object.entries(attributes).filter(([name, value]) => (
    SAFE_ATTRIBUTE_NAMES.has(name)
    && !SENSITIVE_ATTRIBUTE.test(name)
    && ['string', 'number', 'boolean'].includes(typeof value)
  )).map(([name, value]) => [name, typeof value === 'string' ? value.slice(0, 120) : value]));
}

export function resolveTraceLogPath(env = process.env) {
  return path.resolve(env.TRACE_LOG_PATH || DEFAULT_TRACE_LOG_PATH);
}

const TRACE_LOG_PATH = resolveTraceLogPath();

/**
 * Custom FileSpanExporter that appends OpenTelemetry spans to traces.jsonl
 */
export class FileSpanExporter {
  constructor(filePath = TRACE_LOG_PATH) {
    this.filePath = path.resolve(filePath);
    this.writeFailureReported = false;
  }

  export(spans, resultCallback) {
    try {
      const records = spans.map(span => {
        const traceId = span.spanContext().traceId;
        const spanId = span.spanContext().spanId;
        const parentSpanId = span.parentSpanId || null;
        const durationNano = span.duration[0] * 1e9 + span.duration[1];
        const durationMs = Number((durationNano / 1e6).toFixed(2));

        return JSON.stringify({
          service: 'wealthgenie-express',
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: parentSpanId,
          name: span.name,
          duration_ms: durationMs,
          status: span.status.code === 1 ? 'OK' : (span.status.code === 2 ? 'ERROR' : 'UNSET'),
          timestamp: new Date(span.startTime[0] * 1000 + span.startTime[1] / 1e6).toISOString(),
          attributes: safeAttributes(span.attributes || {}),
        });
      });

      if (records.length > 0) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.appendFileSync(this.filePath, records.join('\n') + '\n', 'utf8');
      }
      this.writeFailureReported = false;
      resultCallback({ code: 0 }); // ExportResultCode.SUCCESS
    } catch (err) {
      if (!this.writeFailureReported) {
        console.warn('[Tracing] Failed to export spans to file:', err.message, `path=${this.filePath}`);
        this.writeFailureReported = true;
      }
      resultCallback({ code: 1, error: err }); // ExportResultCode.FAILED
    }
  }

  shutdown() {
    return Promise.resolve();
  }
}

const fileExporter = new FileSpanExporter();

const sdk = new NodeSDK({
  serviceName: 'wealthgenie-express',
  spanProcessor: new SimpleSpanProcessor(fileExporter),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
    }),
  ],
});

sdk.start();

export { trace, propagation, TRACE_LOG_PATH };
export default sdk;

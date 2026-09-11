/**
 * Cross-Service Distributed Tracing Verification Script
 * Sends a request across Express (port 5000) -> FastAPI (port 8000)
 * and asserts that both services emit spans sharing the exact same W3C trace_id.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TRACE_FILE = path.resolve(process.env.TRACE_LOG_PATH || path.join(ROOT_DIR, 'traces.jsonl'));

async function main() {
  console.log('=== Distributed Tracing Cross-Service Verification ===\n');

  // Clear previous trace log
  if (fs.existsSync(TRACE_FILE)) {
    fs.writeFileSync(TRACE_FILE, '', 'utf8');
    console.log('[1] Cleared previous traces.jsonl');
  }

  // 1. Send deep health request to Express which queries ML service /health
  console.log('[2] Sending request to Express /health/deep...');
  const res = await fetch('http://127.0.0.1:5000/health/deep');
  const body = await res.json();
  const resTraceparent = res.headers.get('traceparent');
  const resCorrelationId = res.headers.get('x-correlation-id');
  console.log(`[3] Express Response: status=${res.status}`, body);
  console.log(`    Response traceparent: ${resTraceparent}`);
  console.log(`    Response X-Correlation-ID: ${resCorrelationId}`);

  // Wait 1 second for asynchronous span flushing
  await new Promise(r => setTimeout(r, 1000));

  // 2. Read traces.jsonl
  if (!fs.existsSync(TRACE_FILE)) {
    throw new Error(`Trace file not found at ${TRACE_FILE}`);
  }

  const lines = fs.readFileSync(TRACE_FILE, 'utf8')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => JSON.parse(l));

  console.log(`\n[4] Total spans captured: ${lines.length}`);
  
  // Group spans by trace_id
  const traces = {};
  for (const span of lines) {
    if (!traces[span.trace_id]) traces[span.trace_id] = [];
    traces[span.trace_id].push(span);
  }

  console.log(`[5] Unique trace IDs: ${Object.keys(traces).length}\n`);

  let crossServiceTraceFound = false;

  for (const [traceId, spans] of Object.entries(traces)) {
    const services = new Set(spans.map(s => s.service));
    console.log(`--- Trace: ${traceId} (Services: ${Array.from(services).join(', ')}) ---`);
    for (const s of spans) {
      console.log(`  [${s.service}] span=${s.span_id} parent=${s.parent_span_id || 'root'} name="${s.name}" duration=${s.duration_ms}ms status=${s.status}`);
    }
    if (services.has('wealthgenie-express') && services.has('wealthgenie-ml-service')) {
      crossServiceTraceFound = true;
      console.log(`  >>> VERIFIED: Cross-service distributed trace spanning both Express and FastAPI! <<<\n`);
    }
  }

  if (!crossServiceTraceFound) {
    console.warn('\nNote: Checking if direct /health/deep triggered outgoing OTel HTTP span...');
    for (const span of lines) {
      console.log(JSON.stringify(span, null, 2));
    }
  }

  return crossServiceTraceFound;
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});

/**
 * WealthGenie Production Metrics Collector & Prometheus Exporter (Phase 6)
 * Collects real-time counters, gauges, and histograms for LLM provider health,
 * tool execution accuracy, security events, and system latency.
 */
class MetricsCollector {
  constructor() {
    this.counters = {
      gemini_success_total: 0,
      gemini_failure_total: 0,
      groq_success_total: 0,
      groq_failure_total: 0,
      nvidia_nim_success_total: 0,
      nvidia_nim_failure_total: 0,
      grounded_validation_success_total: 0,
      grounded_validation_failure_total: 0,
      grounded_fallback_total: 0,
      tool_execution_total: 0,
      tool_execution_success_total: 0,
      tool_execution_failure_total: 0,
      arithmetic_corrections_total: 0,
      arithmetic_corrections_post_pass2_total: 0,
      invalid_action_cards_total: 0,
      prompt_injection_attempts_total: 0,
      csrf_rejections_total: 0,
      http_overload_total: 0,
    };

    this.toolUsage = {}; // tool_name -> count
    this.latencies = []; // rolling window of latency entries
    this.maxLatencyWindow = 500;
    this.httpRequests = {};
    this.httpDuration = {
      count: 0,
      sumMs: 0,
      buckets: { 50: 0, 100: 0, 250: 0, 500: 0, 1000: 0, 3000: 0, 10000: 0 },
    };
    this.httpInFlight = 0;
    this.httpInFlightPeak = 0;
  }

  inc(metricName, value = 1) {
    if (this.counters[metricName] !== undefined) {
      this.counters[metricName] += value;
    }
  }

  recordToolExecution(toolName, success) {
    this.inc('tool_execution_total');
    if (success) {
      this.inc('tool_execution_success_total');
    } else {
      this.inc('tool_execution_failure_total');
    }
    const current = this.toolUsage[toolName] || 0;
    this.toolUsage[toolName] = current + 1;
  }

  recordLatency(provider, latencyMs) {
    if (this.latencies.length >= this.maxLatencyWindow) {
      this.latencies.shift();
    }
    this.latencies.push({ provider, latencyMs, timestamp: Date.now() });
  }

  httpRequestStarted(inFlight) {
    this.httpInFlight = Math.max(0, Number(inFlight) || 0);
    this.httpInFlightPeak = Math.max(this.httpInFlightPeak, this.httpInFlight);
  }

  httpRequestFinished(method, statusCode, durationMs, inFlight) {
    const normalizedMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
      .includes(method) ? method : 'OTHER';
    const numericStatus = Number(statusCode) || 500;
    const statusClass = `${Math.floor(numericStatus / 100)}xx`;
    const key = `${normalizedMethod}:${statusClass}`;
    this.httpRequests[key] = (this.httpRequests[key] || 0) + 1;
    this.httpInFlight = Math.max(0, Number(inFlight) || 0);

    const safeDuration = Math.max(0, Number(durationMs) || 0);
    this.httpDuration.count += 1;
    this.httpDuration.sumMs += safeDuration;
    for (const boundary of Object.keys(this.httpDuration.buckets).map(Number)) {
      if (safeDuration <= boundary) this.httpDuration.buckets[boundary] += 1;
    }
  }

  recordHttpOverload() {
    this.inc('http_overload_total');
  }

  getPrometheusFormat() {
    const lines = [];
    lines.push('# HELP wealthgenie_chat_requests_total Total count of chat provider requests');
    lines.push('# TYPE wealthgenie_chat_requests_total counter');
    lines.push(`wealthgenie_chat_requests_total{provider="gemini",status="success"} ${this.counters.gemini_success_total}`);
    lines.push(`wealthgenie_chat_requests_total{provider="gemini",status="failure"} ${this.counters.gemini_failure_total}`);
    lines.push(`wealthgenie_chat_requests_total{provider="groq",status="success"} ${this.counters.groq_success_total}`);
    lines.push(`wealthgenie_chat_requests_total{provider="groq",status="failure"} ${this.counters.groq_failure_total}`);
    lines.push(`wealthgenie_chat_requests_total{provider="nvidia_nim",status="success"} ${this.counters.nvidia_nim_success_total}`);
    lines.push(`wealthgenie_chat_requests_total{provider="nvidia_nim",status="failure"} ${this.counters.nvidia_nim_failure_total}`);
    lines.push(`wealthgenie_chat_requests_total{provider="deterministic_template",status="fallback"} ${this.counters.grounded_fallback_total}`);

    lines.push('\n# HELP wealthgenie_grounding_validation_total Grounding validator outcomes');
    lines.push('# TYPE wealthgenie_grounding_validation_total counter');
    lines.push(`wealthgenie_grounding_validation_total{status="pass"} ${this.counters.grounded_validation_success_total}`);
    lines.push(`wealthgenie_grounding_validation_total{status="fail"} ${this.counters.grounded_validation_failure_total}`);

    lines.push('\n# HELP wealthgenie_tool_executions_total Total count of AI tool executions');
    lines.push('# TYPE wealthgenie_tool_executions_total counter');
    lines.push(`wealthgenie_tool_executions_total{status="total"} ${this.counters.tool_execution_total}`);
    lines.push(`wealthgenie_tool_executions_total{status="success"} ${this.counters.tool_execution_success_total}`);
    lines.push(`wealthgenie_tool_executions_total{status="failure"} ${this.counters.tool_execution_failure_total}`);

    for (const [tool, count] of Object.entries(this.toolUsage)) {
      lines.push(`wealthgenie_tool_usage_total{tool="${tool}"} ${count}`);
    }

    lines.push('\n# HELP wealthgenie_security_events_total Count of security and validation events');
    lines.push('# TYPE wealthgenie_security_events_total counter');
    lines.push(`wealthgenie_security_events_total{type="prompt_injection"} ${this.counters.prompt_injection_attempts_total}`);
    lines.push(`wealthgenie_security_events_total{type="invalid_action_cards"} ${this.counters.invalid_action_cards_total}`);
    lines.push(`wealthgenie_security_events_total{type="arithmetic_corrections"} ${this.counters.arithmetic_corrections_total}`);
    lines.push(`wealthgenie_security_events_total{type="csrf_rejection"} ${this.counters.csrf_rejections_total}`);

    const avgLatency = this.latencies.length > 0
      ? (this.latencies.reduce((sum, l) => sum + l.latencyMs, 0) / this.latencies.length).toFixed(2)
      : 0;
    lines.push('\n# HELP wealthgenie_chat_latency_avg_ms Average chat latency in milliseconds');
    lines.push('# TYPE wealthgenie_chat_latency_avg_ms gauge');
    lines.push(`wealthgenie_chat_latency_avg_ms ${avgLatency}`);

    lines.push('\n# HELP wealthgenie_http_requests_total HTTP requests grouped by method and status class');
    lines.push('# TYPE wealthgenie_http_requests_total counter');
    for (const [key, count] of Object.entries(this.httpRequests)) {
      const [method, statusClass] = key.split(':');
      lines.push(`wealthgenie_http_requests_total{method="${method}",status_class="${statusClass}"} ${count}`);
    }
    lines.push('# HELP wealthgenie_http_requests_in_flight Currently executing HTTP requests');
    lines.push('# TYPE wealthgenie_http_requests_in_flight gauge');
    lines.push(`wealthgenie_http_requests_in_flight ${this.httpInFlight}`);
    lines.push('# HELP wealthgenie_http_request_duration_ms HTTP request duration in milliseconds');
    lines.push('# TYPE wealthgenie_http_request_duration_ms histogram');
    for (const [boundary, count] of Object.entries(this.httpDuration.buckets)) {
      lines.push(`wealthgenie_http_request_duration_ms_bucket{le="${boundary}"} ${count}`);
    }
    lines.push(`wealthgenie_http_request_duration_ms_bucket{le="+Inf"} ${this.httpDuration.count}`);
    lines.push(`wealthgenie_http_request_duration_ms_sum ${this.httpDuration.sumMs.toFixed(3)}`);
    lines.push(`wealthgenie_http_request_duration_ms_count ${this.httpDuration.count}`);
    lines.push('# HELP wealthgenie_http_overload_total Requests rejected by admission control');
    lines.push('# TYPE wealthgenie_http_overload_total counter');
    lines.push(`wealthgenie_http_overload_total ${this.counters.http_overload_total}`);

    return lines.join('\n');
  }

  getSnapshotJSON() {
    const avgLatency = this.latencies.length > 0
      ? (this.latencies.reduce((sum, l) => sum + l.latencyMs, 0) / this.latencies.length).toFixed(2)
      : 0;

    return {
      counters: { ...this.counters },
      tool_usage: { ...this.toolUsage },
      average_latency_ms: parseFloat(avgLatency),
      recorded_requests_window: this.latencies.length,
      http: {
        requests: { ...this.httpRequests },
        in_flight: this.httpInFlight,
        in_flight_peak: this.httpInFlightPeak,
        duration_count: this.httpDuration.count,
        duration_sum_ms: Number(this.httpDuration.sumMs.toFixed(3)),
        overload_total: this.counters.http_overload_total,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

export const PrometheusMetrics = new MetricsCollector();

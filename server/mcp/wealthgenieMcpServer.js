import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import Ajv from 'ajv';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import parseJoi from 'joi-to-json';
import FinancialProfile from '../models/FinancialProfile.js';
import { FinancialToolRegistry } from '../services/financialToolRegistry.js';
import { buildRecommendationProfile } from '../services/recommendationProfile.js';
import { MCP_TOOL_POLICY, buildMcpResult, isMcpToolAllowed, mcpOutputSchema } from './toolPolicy.js';
import { McpCapacityError } from './mcpCapacity.js';
import { PrometheusMetrics } from '../services/metricsCollector.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_RESULT_BYTES = 32768;
const MAX_RESULT_DEPTH = 12;
const MAX_RESULT_NODES = 4000;
const GENERIC_EXECUTION_ERROR = 'The requested calculation could not be completed.';
const SAFE_MCP_ERROR_CODES = new Set([
  'MCP_TOOL_NOT_ALLOWED', 'MCP_INVALID_ARGUMENTS', 'MCP_PROFILE_CONTEXT_REQUIRED',
  'MCP_PROFILE_CONTEXT_NOT_FOUND', 'MCP_PROFILE_CONTEXT_INVALID', 'MCP_TOOL_TIMEOUT',
  'MCP_CLIENT_CANCELLED', 'MCP_SHUTDOWN', 'MCP_DRAINING', 'MCP_CAPACITY_EXCEEDED',
  'MCP_CAPACITY_UNAVAILABLE', 'MCP_UNSAFE_PROPERTY', 'MCP_PAYLOAD_COMPLEXITY_LIMIT',
  'MCP_NON_FINITE_NUMBER', 'MCP_STRING_LIMIT', 'MCP_RESULT_TOO_LARGE',
]);
const validateOutput = new Ajv({ allErrors: false, strict: false }).compile(mcpOutputSchema());

export class McpRequestError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'McpRequestError';
    this.code = code;
  }
}

function removeJoiPatternPlaceholders(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.patternProperties && schema.properties) {
    for (const property of Object.keys(schema.properties)) {
      const unwrapped = property.startsWith('/') && property.endsWith('/') ? property.slice(1, -1) : property;
      if (Object.hasOwn(schema.patternProperties, property) || Object.hasOwn(schema.patternProperties, unwrapped)) {
        delete schema.properties[property];
      }
    }
    const patterns = Object.keys(schema.patternProperties);
    if (patterns.length === 1) schema.propertyNames = { pattern: patterns[0] };
  }
  for (const child of Object.values(schema)) {
    if (Array.isArray(child)) child.forEach(removeJoiPatternPlaceholders);
    else if (child && typeof child === 'object') removeJoiPatternPlaceholders(child);
  }
}

export function convertJoiToJsonSchema(joiSchema, { maxXirrCashflows = 600, maxXirrAbsAmount = 1000000000000 } = {}) {
  const jsonSchema = parseJoi(joiSchema) || {};
  if (!jsonSchema.type) jsonSchema.type = 'object';
  if (!jsonSchema.properties) jsonSchema.properties = {};
  delete jsonSchema.$schema;
  // joi-to-json expresses Joi's object default with additionalProperties:false
  // in current releases; preserve that strictness as an explicit contract.
  if (joiSchema?.type === 'object' && jsonSchema.additionalProperties === undefined) {
    jsonSchema.additionalProperties = false;
  }
  removeJoiPatternPlaceholders(jsonSchema);
  if (jsonSchema.properties?.cashflows?.items?.properties?.amount) {
    jsonSchema.properties.cashflows.maxItems = maxXirrCashflows;
    jsonSchema.properties.cashflows.items.properties.amount.minimum = -maxXirrAbsAmount;
    jsonSchema.properties.cashflows.items.properties.amount.maximum = maxXirrAbsAmount;
    jsonSchema.properties.cashflows.items.properties.date = {
      type: 'string',
        format: 'date',
        maxLength: 10,
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    };
  }
  return jsonSchema;
}

function inspectJson(value, { maxDepth = MAX_RESULT_DEPTH, maxNodes = MAX_RESULT_NODES } = {}) {
  let nodes = 0;
  const visit = (item, depth) => {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) throw new McpRequestError('MCP_PAYLOAD_COMPLEXITY_LIMIT');
    if (typeof item === 'number' && !Number.isFinite(item)) throw new McpRequestError('MCP_NON_FINITE_NUMBER');
    if (typeof item === 'string' && (item.includes('\0') || item.length > 8192)) throw new McpRequestError('MCP_STRING_LIMIT');
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
    } else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (DANGEROUS_KEYS.has(key) || key.startsWith('__')) throw new McpRequestError('MCP_UNSAFE_PROPERTY');
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
}

export function validateMcpPayload(value) {
  inspectJson(value, { maxDepth: 16, maxNodes: 5000 });
  return true;
}

function safeMcpError(error) {
  const code = SAFE_MCP_ERROR_CODES.has(error?.code) ? error.code : 'MCP_TOOL_EXECUTION_FAILED';
  const messages = {
    MCP_CAPACITY_EXCEEDED: 'MCP calculation capacity is temporarily exhausted.',
    MCP_CAPACITY_UNAVAILABLE: 'MCP capacity control is temporarily unavailable.',
    MCP_PROFILE_CONTEXT_REQUIRED: 'Select an owned financial profile for this simulation.',
    MCP_PROFILE_CONTEXT_NOT_FOUND: 'The selected financial profile is unavailable.',
    MCP_PROFILE_CONTEXT_INVALID: 'The selected profile cannot be used for this simulation.',
    MCP_TOOL_TIMEOUT: 'The MCP calculation exceeded its time budget.',
    MCP_CLIENT_CANCELLED: 'The MCP request was cancelled.',
    MCP_SHUTDOWN: 'MCP is shutting down.',
    MCP_INVALID_ARGUMENTS: 'The tool arguments do not match the published input schema.',
    MCP_UNSAFE_PROPERTY: 'The request contains a prohibited property.',
    MCP_PAYLOAD_COMPLEXITY_LIMIT: 'The request exceeds the supported structural limits.',
    MCP_NON_FINITE_NUMBER: 'The request contains an invalid numeric value.',
    MCP_STRING_LIMIT: 'The request contains an oversized or invalid string.',
  };
  return { code, message: messages[code] || GENERIC_EXECUTION_ERROR };
}

function boundedResult(value) {
  inspectJson(value);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > MAX_RESULT_BYTES) throw new McpRequestError('MCP_RESULT_TOO_LARGE');
  return { text, value };
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function loadOwnedProfile({ profileId, userId, profileModel = FinancialProfile }) {
  if (!profileId) throw new McpRequestError('MCP_PROFILE_CONTEXT_REQUIRED');
  if (!mongoose.isValidObjectId(profileId)) throw new McpRequestError('MCP_PROFILE_CONTEXT_NOT_FOUND');
  const document = await profileModel.findOne({ _id: profileId, userId }).lean();
  if (!document) throw new McpRequestError('MCP_PROFILE_CONTEXT_NOT_FOUND');
  try {
    if (!Number.isSafeInteger(document.version) || document.version < 1) {
      throw new McpRequestError('MCP_PROFILE_CONTEXT_INVALID');
    }
    const profile = buildRecommendationProfile(document);
    return {
      profile,
      version: document.version,
      snapshotHash: sha256(profile),
    };
  } catch {
    throw new McpRequestError('MCP_PROFILE_CONTEXT_INVALID');
  }
}

function resultForError(error) {
  const safe = safeMcpError(error);
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(safe) }],
  };
}

function toolResult(name, result, tool, profileSnapshot) {
  const wrapped = buildMcpResult({
    toolName: name,
    tool,
    result,
    profile: profileSnapshot?.profile || null,
    profileVersion: profileSnapshot?.version ?? null,
    profileSnapshotHash: profileSnapshot?.snapshotHash ?? null,
  });
  if (!validateOutput(wrapped)) throw new McpRequestError('MCP_RESULT_SCHEMA_INVALID');
  const bounded = boundedResult(wrapped);
  return { content: [{ type: 'text', text: bounded.text }], structuredContent: bounded.value };
}

function finalizeToolExecution(operation, release, startedAt, runtime) {
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    PrometheusMetrics.recordMcpToolDuration(Date.now() - startedAt);
    PrometheusMetrics.setGauge('mcp_active_tool_executions', runtime?.snapshot().activeTools || 0);
    void release();
  };
  // Handle both fulfillment and rejection explicitly; a bare finally() would
  // create a second rejected promise on failure and can trigger an unhandled
  // rejection during timeout, cancellation, or shutdown.
  void operation.settled.then(finalize, finalize);
}

function createServer({ transportKind, principal = null, profileId = null, capacity = null, runtime = null, config = null, parentSignal = null }) {
  const server = new Server(
    { name: 'WealthGenie MCP Tools', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: FinancialToolRegistry.listMcpTools({ transport: transportKind }).map(({ name, description, version }) => {
      const tool = FinancialToolRegistry.getTool(name);
      const definition = {
        name,
        description: `${description} Results are non-authoritative calculations, not recommendations.`,
        inputSchema: convertJoiToJsonSchema(tool.schema, {
          maxXirrCashflows: config?.maxXirrCashflows || 600,
          maxXirrAbsAmount: config?.maxXirrAbsAmount || 1000000000000,
        }),
        outputSchema: mcpOutputSchema(),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { wealthgenie: { toolVersion: version, authority: 'NON_AUTHORITATIVE', profileContext: tool.mcpPolicy.profileContext, costClass: tool.mcpPolicy.costClass } },
      };
      return definition;
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    const tool = FinancialToolRegistry.getTool(name);
    if (!tool || !isMcpToolAllowed(tool, { transport: transportKind })) {
      return resultForError(new McpRequestError('MCP_TOOL_NOT_ALLOWED'));
    }
    try {
      inspectJson(args || {});
      if (name === 'xirr_calculator') {
        const cashflows = args?.cashflows;
        if (!Array.isArray(cashflows)
            || cashflows.length > (config?.maxXirrCashflows || 600)
            || cashflows.some(flow => Math.abs(flow.amount) > (config?.maxXirrAbsAmount || 1000000000000))) {
          throw new McpRequestError('MCP_INVALID_ARGUMENTS');
        }
      }
      if (transportKind === 'stdio' && tool.mcpPolicy.profileContext === 'required') {
        throw new McpRequestError('MCP_PROFILE_CONTEXT_REQUIRED');
      }
      const release = transportKind === 'remote'
        ? await capacity.acquireToolPermit(principal.userId, name, tool.mcpPolicy.costClass)
        : () => {};
      PrometheusMetrics.inc('mcp_tool_calls_total');
      const executionStartedAt = Date.now();
      let profileSnapshot = null;
      let operation;
      try {
        const execute = async signal => {
            if (signal.aborted) throw signal.reason || new McpRequestError('MCP_CLIENT_CANCELLED');
            if (tool.mcpPolicy.profileContext === 'required' || (tool.mcpPolicy.profileContext === 'optional' && profileId)) {
              profileSnapshot = await loadOwnedProfile({ profileId, userId: principal.userId });
            }
            if (signal.aborted) throw signal.reason || new McpRequestError('MCP_CLIENT_CANCELLED');
            const execution = await FinancialToolRegistry.executeTool(name, args || {}, {
              ...(profileSnapshot ? { profile: profileSnapshot.profile } : {}),
              signal,
              mcpRequest: true,
            });
            if (!execution.success) throw new McpRequestError('MCP_INVALID_ARGUMENTS');
            return execution.result;
          };
        operation = runtime
          ? runtime.startTool(execute, parentSignal)
          : {
            result: execute(new AbortController().signal),
            settled: Promise.resolve(),
          };
        finalizeToolExecution(operation, release, executionStartedAt, runtime);
        const result = await operation.result;
        const response = toolResult(name, result, tool, profileSnapshot);
        PrometheusMetrics.inc('mcp_tool_successes_total');
        return response;
      } catch (error) {
        PrometheusMetrics.inc('mcp_tool_failures_total');
        if (error instanceof McpCapacityError) PrometheusMetrics.inc('mcp_capacity_rejections_total');
        if (error?.code === 'MCP_TOOL_TIMEOUT') PrometheusMetrics.inc('mcp_tool_timeouts_total');
        if (operation?.settled) finalizeToolExecution(operation, release, executionStartedAt, runtime);
        else await release();
        return resultForError(error);
      }
    } catch (error) {
      PrometheusMetrics.inc('mcp_tool_failures_total');
      if (error instanceof McpCapacityError) PrometheusMetrics.inc('mcp_capacity_rejections_total');
      return resultForError(error);
    }
  });
  return server;
}

export class WealthGenieMcpServer {
  static convertJoiToJsonSchema = convertJoiToJsonSchema;

  static getToolDefinitions({ transport = 'remote', config = null } = {}) {
    return FinancialToolRegistry.listMcpTools({ transport }).map(({ name, description, version }) => {
      const tool = FinancialToolRegistry.getTool(name);
      return {
        name, description, version,
        parameters: convertJoiToJsonSchema(tool.schema, {
          maxXirrCashflows: config?.maxXirrCashflows || 600,
          maxXirrAbsAmount: config?.maxXirrAbsAmount || 1000000000000,
        }),
        outputSchema: mcpOutputSchema(),
      };
    });
  }

  static executeTool(name, args = {}, context = {}) {
    return FinancialToolRegistry.executeTool(name, args, context);
  }

  async connectStdio() {
    const server = createServer({ transportKind: 'stdio' });
    await server.connect(new StdioServerTransport());
    console.error('[WealthGenieMcpServer] Connected using explicitly allowlisted stdio tools.');
  }
}

export async function handleStatelessMcpRequest(req, res, {
  principal,
  profileId = null,
  capacity,
  runtime,
  config,
} = {}) {
  const requestLease = runtime.acquireRequest();
  const abortRequest = () => requestLease.abort(new McpRequestError('MCP_CLIENT_CANCELLED'));
  req.once('aborted', abortRequest);
  res.once('close', () => { if (!res.writableEnded) abortRequest(); });
  const server = createServer({
    transportKind: 'remote', principal, profileId, capacity, runtime, config,
    parentSignal: requestLease.signal,
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    req.off('aborted', abortRequest);
    requestLease.release();
    await server.close().catch(() => {});
  }
}

export function isMcpToolKnown(name) {
  return Object.hasOwn(MCP_TOOL_POLICY, name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  new WealthGenieMcpServer().connectStdio().catch(error => {
    console.error('[WealthGenieMcpServer] stdio startup failed:', error?.code || 'MCP_START_FAILED');
    process.exitCode = 1;
  });
}

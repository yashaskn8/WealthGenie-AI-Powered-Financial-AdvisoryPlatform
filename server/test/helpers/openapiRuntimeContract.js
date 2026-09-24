import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const runtimeOpenApi = parse(fs.readFileSync(path.join(serverRoot, 'openapi.yaml'), 'utf8'));

function resolveLocalRef(ref) {
  assert.match(ref, /^#\//, `Only local OpenAPI references are supported: ${ref}`);
  return ref.slice(2).split('/').reduce((value, key) => value[key], runtimeOpenApi);
}

function dereference(value, activeRefs = new Set()) {
  if (Array.isArray(value)) return value.map(item => dereference(item, activeRefs));
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$ref === 'string') {
    assert.equal(value.$ref.startsWith('#/'), true, `Only local refs are supported: ${value.$ref}`);
    assert.equal(activeRefs.has(value.$ref), false, `Recursive schema is not supported: ${value.$ref}`);
    const nextRefs = new Set(activeRefs);
    nextRefs.add(value.$ref);
    return dereference(resolveLocalRef(value.$ref), nextRefs);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, dereference(child, activeRefs)]));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

/** Validate a response captured from an actual HTTP request against its exact OpenAPI operation/status. */
export function assertRuntimeResponseMatchesContract({ method, path: routePath, status, contentType, body }) {
  const operation = runtimeOpenApi.paths[routePath]?.[method.toLowerCase()];
  assert.ok(operation, `OpenAPI operation missing: ${method} ${routePath}`);
  const response = operation.responses?.[String(status)];
  assert.ok(response, `Undocumented runtime status ${status}: ${method} ${routePath}`);
  const resolved = dereference(response);
  const media = resolved.content?.['application/json'];
  assert.ok(media?.schema, `No application/json schema for ${method} ${routePath} ${status}`);
  assert.match(contentType || '', /^application\/json\b/i, `${method} ${routePath} did not return JSON`);
  const validate = ajv.compile(dereference(media.schema));
  assert.equal(validate(body), true,
    `${method} ${routePath} ${status} violates OpenAPI: ${JSON.stringify(validate.errors)}`);
}

/** Data-driven actual HTTP case runner shared by contract suites. */
export async function runOpenApiHttpCase({ baseUrl, method, path: routePath, url = routePath, headers = {}, body, expectedStatus, setup }) {
  await setup?.({ baseUrl, method, path: routePath, url });
  const response = await fetch(new URL(url, baseUrl), {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const responseBody = await response.json();
  if (expectedStatus !== undefined) {
    assert.equal(response.status, expectedStatus, `${method} ${url}`);
  }
  assertRuntimeResponseMatchesContract({
    method, path: routePath, status: response.status,
    contentType: response.headers.get('content-type'), body: responseBody,
  });
  return { response, body: responseBody };
}

export async function assertFetchResponseMatchesOpenApi(response, method, routePath, { body: suppliedBody } = {}) {
  const body = suppliedBody === undefined ? await response.clone().json() : suppliedBody;
  assertRuntimeResponseMatchesContract({
    method,
    path: routePath,
    status: response.status,
    contentType: response.headers.get('content-type'),
    body,
  });
  return body;
}

import Ajv from 'ajv';
import {
  FINANCIAL_CLAIM_TYPES,
  FINANCIAL_CLAIM_UNITS,
} from './typedFinancialClaims.js';
import { SAFE_PLAN_REVIEW_TOOLS } from '../agents/planReview/planReviewSchemas.js';

const closedObject = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const nullableString = { type: ['string', 'null'] };
const deepFreeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
};

export const PROVIDER_OUTPUT_CONTRACTS = deepFreeze({
  PLAN_REVIEW_PLANNER_V1: {
    name: 'plan_review_planner_v1',
    schema: closedObject({
      checks: {
        type: 'array',
        minItems: 1,
        maxItems: SAFE_PLAN_REVIEW_TOOLS.length,
        items: { type: 'string', enum: [...SAFE_PLAN_REVIEW_TOOLS] },
      },
    }),
  },
  GROUNDED_EXPLANATION_V1: {
    name: 'grounded_explanation_v1',
    schema: closedObject({
      text: { type: 'string', minLength: 1, maxLength: 12000 },
      evidenceIdsUsed: {
        type: 'array', minItems: 1, maxItems: 40,
        items: { type: 'string', pattern: '^E_[A-Z0-9_:-]+$' },
      },
      claims: {
        type: 'array', minItems: 1, maxItems: 40,
        items: closedObject({
          text: { type: 'string', minLength: 1, maxLength: 2000 },
          evidenceIds: {
            type: 'array', minItems: 1, maxItems: 20,
            items: { type: 'string', pattern: '^E_[A-Z0-9_:-]+$' },
          },
        }),
      },
      financialClaims: {
        type: 'array', maxItems: 40,
        items: closedObject({
          type: { type: 'string', enum: [...FINANCIAL_CLAIM_TYPES] },
          value: { type: 'number' },
          unit: { type: 'string', enum: [...FINANCIAL_CLAIM_UNITS] },
          timePeriod: { type: 'string', minLength: 1, maxLength: 80 },
          source: { type: 'string', minLength: 1, maxLength: 120 },
          evidenceId: { type: 'string', pattern: '^E_[A-Z0-9_:-]+$' },
          jurisdiction: nullableString,
          effectivePeriod: {
            anyOf: [
              closedObject({
                from: { type: 'string' },
                to: nullableString,
              }),
              { type: 'null' },
            ],
          },
          statement: { type: 'string', minLength: 1, maxLength: 500 },
        }),
      },
      unavailableFacts: {
        type: 'array', maxItems: 20,
        items: { type: 'string', maxLength: 120 },
      },
    }),
  },
});

const ajv = new Ajv({ allErrors: false, strict: false, allowUnionTypes: true });
const validators = new Map(Object.entries(PROVIDER_OUTPUT_CONTRACTS)
  .map(([id, contract]) => [id, ajv.compile(contract.schema)]));

export function getProviderOutputContract(contractId) {
  return Object.hasOwn(PROVIDER_OUTPUT_CONTRACTS, contractId)
    ? PROVIDER_OUTPUT_CONTRACTS[contractId]
    : null;
}

export function toGroqStrictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGroqStrictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const omittedConstraints = new Set(['format', 'pattern', 'minItems', 'maxItems', 'minLength', 'maxLength']);
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (omittedConstraints.has(key)) continue;
    result[key] = toGroqStrictSchema(value);
  }
  return result;
}

const GROQ_STRICT_SCHEMA_KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'anyOf', 'description',
]);
const GROQ_STRICT_SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/**
 * Validate the strict-schema structural rules before sending a provider request.
 * Application-level constraints remain in the authoritative Ajv contract; the
 * Groq projection intentionally strips unsupported size/pattern constraints.
 */
export function validateGroqStrictSchema(schema) {
  const issues = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      issues.add('GROQ_SCHEMA_NODE_INVALID');
      return;
    }
    for (const key of Object.keys(node)) {
      if (!GROQ_STRICT_SCHEMA_KEYWORDS.has(key)) issues.add('GROQ_SCHEMA_KEYWORD_UNSUPPORTED');
    }

    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (node.type !== undefined
        && (!types.length || types.some(type => !GROQ_STRICT_SCHEMA_TYPES.has(type))
          || (Array.isArray(node.type) && (types.length < 2 || !types.includes('null') || new Set(types).size !== types.length)))) {
      issues.add('GROQ_SCHEMA_TYPE_INVALID');
    }
    if (node.type === undefined && !Array.isArray(node.anyOf)) issues.add('GROQ_SCHEMA_TYPE_MISSING');

    if (types.includes('object')) {
      const properties = node.properties;
      const names = properties && typeof properties === 'object' && !Array.isArray(properties)
        ? Object.keys(properties)
        : null;
      if (!names || node.additionalProperties !== false) issues.add('GROQ_SCHEMA_OBJECT_NOT_CLOSED');
      if (!Array.isArray(node.required)
          || !names
          || names.length !== node.required.length
          || names.some(name => !node.required.includes(name))) {
        issues.add('GROQ_SCHEMA_REQUIRED_MISMATCH');
      }
      for (const value of Object.values(properties || {})) visit(value);
    }
    if (types.includes('array')) {
      if (!Object.hasOwn(node, 'items')) issues.add('GROQ_SCHEMA_ARRAY_ITEMS_MISSING');
      else visit(node.items);
    }
    if (node.enum !== undefined
        && (!Array.isArray(node.enum) || node.enum.length === 0
          || node.enum.some(value => !['string', 'number', 'boolean'].includes(typeof value)))) {
      issues.add('GROQ_SCHEMA_ENUM_INVALID');
    }
    if (node.anyOf !== undefined) {
      if (!Array.isArray(node.anyOf) || node.anyOf.length < 2) issues.add('GROQ_SCHEMA_UNION_INVALID');
      else node.anyOf.forEach(visit);
    }
  };
  visit(schema);
  return { valid: issues.size === 0, errors: [...issues].sort() };
}

export function validateProviderOutputContract(contractId, value) {
  const validate = validators.get(contractId);
  if (!validate) return { valid: false, errors: ['UNKNOWN_OUTPUT_CONTRACT'] };
  const valid = validate(value);
  return {
    valid: Boolean(valid),
    errors: valid ? [] : (validate.errors || []).map(error => error.keyword),
  };
}

export function toGeminiResponseSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiResponseSchema);
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema.anyOf)) {
    const nullableBranch = schema.anyOf.some(branch => branch?.type === 'null');
    const nonNullableBranches = schema.anyOf.filter(branch => branch?.type !== 'null');
    if (nullableBranch && nonNullableBranches.length === 1) {
      const converted = toGeminiResponseSchema(nonNullableBranches[0]);
      if (typeof converted?.type === 'string') {
        return { ...converted, type: [converted.type, 'null'] };
      }
    }
  }
  const result = {};
  const omittedConstraints = new Set(['pattern', 'minLength', 'maxLength']);
  for (const [key, value] of Object.entries(schema)) {
    if (omittedConstraints.has(key)) continue;
    result[key] = toGeminiResponseSchema(value);
  }
  return result;
}

const QUERY_MUTATORS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
];

const REPLACEMENT_MUTATORS = ['replaceOne', 'findOneAndReplace'];
const UPDATE_OPERATORS = new Set([
  '$addToSet',
  '$bit',
  '$currentDate',
  '$inc',
  '$max',
  '$min',
  '$mul',
  '$pop',
  '$pull',
  '$pullAll',
  '$push',
  '$rename',
  '$set',
  '$setOnInsert',
  '$unset',
]);
const SAFE_PIPELINE_SET_STAGES = new Set(['$set', '$addFields']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeFieldPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) return false;
  const parts = path.split('.');
  return parts.every(part => part.length > 0
    && !part.startsWith('$')
    && part !== '__proto__'
    && part !== 'prototype'
    && part !== 'constructor');
}

function pipelineWrittenPaths(pipeline) {
  if (!Array.isArray(pipeline) || pipeline.length === 0) return null;
  const paths = [];

  for (const stage of pipeline) {
    if (!isPlainObject(stage)) return null;
    const entries = Object.entries(stage);
    if (entries.length !== 1) return null;
    const [[operator, specification]] = entries;

    if (SAFE_PIPELINE_SET_STAGES.has(operator)) {
      if (!isPlainObject(specification)) return null;
      const stagePaths = Object.keys(specification);
      if (stagePaths.some(path => !isSafeFieldPath(path))) return null;
      paths.push(...stagePaths);
      continue;
    }

    // Aggregation $unset accepts one field name or a list of field names.
    // Other forms and every other stage are intentionally outside this guard's
    // statically analyzable subset.
    if (operator === '$unset') {
      const stagePaths = typeof specification === 'string'
        ? [specification]
        : specification;
      if (!Array.isArray(stagePaths) || stagePaths.length === 0
          || stagePaths.some(path => !isSafeFieldPath(path))) return null;
      paths.push(...stagePaths);
      continue;
    }

    return null;
  }

  return paths;
}

function writtenPaths(update, upsert) {
  if (Array.isArray(update)) return pipelineWrittenPaths(update);
  if (!isPlainObject(update)) return null;

  const paths = [];
  const entries = Object.entries(update);
  const hasOperators = entries.some(([key]) => key.startsWith('$'));
  if (hasOperators && entries.some(([key]) => !key.startsWith('$'))) return null;

  for (const [operator, values] of entries) {
    if (!operator.startsWith('$')) {
      if (!isSafeFieldPath(operator)) return null;
      paths.push(operator);
      continue;
    }

    if (!UPDATE_OPERATORS.has(operator)) return null;

    if (operator === '$unset' && (typeof values === 'string' || Array.isArray(values))) {
      const unsetPaths = typeof values === 'string' ? [values] : values;
      if (unsetPaths.some(path => !isSafeFieldPath(path))) return null;
      paths.push(...unsetPaths);
      continue;
    }

    if (!isPlainObject(values)) return null;
    const updatePaths = Object.keys(values);
    if (updatePaths.some(path => !isSafeFieldPath(path))) return null;

    if (operator === '$rename') {
      const destinations = Object.values(values);
      if (destinations.some(path => !isSafeFieldPath(path))) return null;
      paths.push(...updatePaths, ...destinations);
      continue;
    }

    // $setOnInsert cannot mutate an existing row. It may establish immutable
    // identity only on the insert branch of an upsert; without upsert it stays
    // subject to the ordinary immutable-path check.
    if (operator === '$setOnInsert' && upsert) continue;
    paths.push(...updatePaths);
  }

  return paths;
}

export function protectImmutableIdentity(schema, fields, {
  code = 'RESOURCE_IDENTITY_IMMUTABLE',
  label = 'Resource identity',
} = {}) {
  const protectedFields = new Set(fields);
  const touchesProtectedField = path => [...protectedFields].some(field => (
    path === field
    || String(path).startsWith(`${field}.`)
    || field.startsWith(`${path}.`)
  ));
  const immutableError = () => {
    const error = new Error(`${label} fields cannot be changed after creation.`);
    error.code = code;
    return error;
  };

  const assertNoProtectedPaths = paths => {
    if (paths === null || paths.some(touchesProtectedField)) throw immutableError();
  };

  schema.pre('save', function rejectIdentityMutation() {
    if (this.isNew) return;
    if (this.modifiedPaths().some(touchesProtectedField)) throw immutableError();
  });

  for (const operation of QUERY_MUTATORS) {
    schema.pre(operation, function rejectIdentityQueryMutation() {
      const paths = writtenPaths(this.getUpdate(), this.getOptions().upsert === true);
      assertNoProtectedPaths(paths);
    });
  }

  // A replacement is a whole-document write: omitting an identity path removes
  // it just as surely as explicitly changing it. These identity-bearing models
  // have no trusted replacement use case, so reject both replacement APIs.
  for (const operation of REPLACEMENT_MUTATORS) {
    schema.pre(operation, function rejectIdentityReplacement() {
      throw immutableError();
    });
  }

  // Mongoose 8 runs model middleware before sending bulkWrite operations.
  // Inspect every update and fail closed for replacement or pipeline writes;
  // inserts remain valid because they establish, rather than mutate, identity.
  schema.pre('bulkWrite', function rejectIdentityBulkWrite(next, operations) {
    if (!Array.isArray(operations)) throw immutableError();
    for (const operation of operations) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        throw immutableError();
      }
      if (Object.hasOwn(operation, 'replaceOne')) throw immutableError();
      for (const kind of ['updateOne', 'updateMany']) {
        if (!Object.hasOwn(operation, kind)) continue;
        const updateOperation = operation[kind];
        if (!updateOperation || typeof updateOperation !== 'object') throw immutableError();
        const paths = writtenPaths(updateOperation.update, updateOperation.upsert === true);
        assertNoProtectedPaths(paths);
      }
    }
    next();
  });
}

const QUERY_MUTATORS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
];

const REPLACEMENT_MUTATORS = ['replaceOne', 'findOneAndReplace'];

function writtenPaths(update, upsert) {
  if (!update || typeof update !== 'object') return [];
  // Aggregation updates can compute or replace values indirectly; the generic
  // identity guard cannot prove their effects, so protected models reject them.
  if (Array.isArray(update)) return null;
  const paths = [];
  const stages = [update];
  for (const stage of stages) {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return null;
    for (const [operator, values] of Object.entries(stage)) {
      if (operator.startsWith('$')) {
        if (operator === '$setOnInsert' && upsert) continue;
        if (operator === '$unset' && typeof values === 'string') {
          paths.push(values);
          continue;
        }
        if (operator === '$unset' && Array.isArray(values)) {
          paths.push(...values);
          continue;
        }
        if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
        paths.push(...Object.keys(values));
        if (operator === '$rename') paths.push(...Object.values(values));
      } else {
        paths.push(operator);
      }
    }
  }
  return paths;
}

export function protectImmutableIdentity(schema, fields, {
  code = 'RESOURCE_IDENTITY_IMMUTABLE',
  label = 'Resource identity',
} = {}) {
  const protectedFields = new Set(fields);
  const touchesProtectedField = path => [...protectedFields].some(field => (
    path === field || String(path).startsWith(`${field}.`)
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
  schema.pre('bulkWrite', function rejectIdentityBulkWrite(operations) {
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
  });
}

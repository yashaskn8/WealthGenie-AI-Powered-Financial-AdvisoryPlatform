const QUERY_MUTATORS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
];

function writtenPaths(update, upsert) {
  if (!update || typeof update !== 'object') return [];
  const paths = [];
  const stages = Array.isArray(update) ? update : [update];
  for (const stage of stages) {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return null;
    for (const [operator, values] of Object.entries(stage)) {
      if (Array.isArray(update) && ['$replaceRoot', '$replaceWith'].includes(operator)) return null;
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

  schema.pre('save', function rejectIdentityMutation() {
    if (this.isNew) return;
    if (this.modifiedPaths().some(touchesProtectedField)) throw immutableError();
  });

  for (const operation of QUERY_MUTATORS) {
    schema.pre(operation, function rejectIdentityQueryMutation() {
      const paths = writtenPaths(this.getUpdate(), this.getOptions().upsert === true);
      if (paths === null || paths.some(touchesProtectedField)) throw immutableError();
    });
  }
}

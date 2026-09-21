const VALID_MONGO_FLAVORS = new Set(['mongodb', 'documentdb']);

export const OPTIONAL_UNIQUE_FIELDS = Object.freeze([
  'idempotencyOperationId',
  'profileCompletionCandidateId',
]);

export function getMongoFlavor(env = process.env) {
  const flavor = String(env.MONGODB_FLAVOR || 'mongodb').trim().toLowerCase();
  if (!VALID_MONGO_FLAVORS.has(flavor)) {
    throw new Error('MONGODB_FLAVOR must be mongodb or documentdb');
  }
  return flavor;
}

export function getMongoConnectionOptions(env = process.env, baseOptions = {}) {
  const flavor = getMongoFlavor(env);
  if (flavor !== 'documentdb') return { ...baseOptions };

  const caFile = String(env.MONGODB_TLS_CA_FILE || '').trim();
  return {
    ...baseOptions,
    retryWrites: false,
    tls: true,
    ...(caFile ? { tlsCAFile: caFile } : {}),
  };
}

export function validateMongoCompatibilityConfig(env = process.env) {
  const errors = [];
  let flavor;
  try {
    flavor = getMongoFlavor(env);
  } catch (error) {
    errors.push(error.message);
    return { valid: false, errors };
  }

  if (flavor === 'documentdb'
      && env.NODE_ENV === 'production'
      && !String(env.MONGODB_TLS_CA_FILE || '').trim()) {
    errors.push('MONGODB_TLS_CA_FILE is required in production DocumentDB mode');
  }
  if (String(env.MONGODB_TLS_ALLOW_INVALID_CERTS || '').toLowerCase() === 'true') {
    errors.push('MONGODB_TLS_ALLOW_INVALID_CERTS is not permitted; certificate verification must remain enabled');
  }
  return { valid: errors.length === 0, errors };
}

export function optionalUniqueIndex(field, name) {
  if (!OPTIONAL_UNIQUE_FIELDS.includes(field) && field !== 'chain_sequence') {
    throw new Error(`Unsupported optional unique index field: ${field}`);
  }
  return {
    key: { [field]: 1 },
    options: {
      name,
      unique: true,
      partialFilterExpression: { [field]: { $exists: true } },
    },
  };
}

export function omitUnsetOptionalUniqueFields(document) {
  const copy = { ...document };
  for (const field of OPTIONAL_UNIQUE_FIELDS) {
    if (copy[field] === null || copy[field] === undefined || copy[field] === '') delete copy[field];
  }
  return copy;
}

/** Normalize native Mongo findOneAndUpdate return shapes across driver versions. */
export function unwrapMongoDocument(result) {
  if (result == null) return null;
  if (typeof result === 'object'
      && Object.prototype.hasOwnProperty.call(result, 'value')
      && !Object.prototype.hasOwnProperty.call(result, '_id')) {
    return result.value ?? null;
  }
  return result;
}

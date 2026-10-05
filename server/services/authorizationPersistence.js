import { verifyAuthorizationPersistenceIndexes } from './persistenceIndexReadiness.js';

let ready = null;

export async function warmAuthorizationPersistence() {
  if (!ready) {
    // Do not run index DDL during application startup. The explicit migration
    // provisions schema indexes; runtime only verifies durable uniqueness.
    ready = verifyAuthorizationPersistenceIndexes({ force: true }).catch(error => {
      ready = null;
      throw error;
    });
  }
  await ready;
}

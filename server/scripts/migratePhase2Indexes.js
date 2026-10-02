import mongoose from 'mongoose';
import {
  migrateMarketDataPersistenceIndexes,
  migratePersistenceIndexes,
} from '../services/persistenceIndexReadiness.js';
import { reconcileLegacyFinancialProfileStates } from '../services/financialProfileStateMigration.js';

const uri = String(process.env.MONGODB_MIGRATION_URI || '').trim();
if (!uri) {
  throw new Error('MONGODB_MIGRATION_URI is required for the explicit Phase 2 index migration.');
}

try {
  await mongoose.connect(uri, { autoIndex: false });
  const result = await migratePersistenceIndexes();
  const marketDataResult = await migrateMarketDataPersistenceIndexes();
  const profileStateReport = await reconcileLegacyFinancialProfileStates();
  process.stdout.write(`Phase 2 indexes verified at ${result.verifiedAt}; market-data indexes verified at ${marketDataResult.verifiedAt}; profile-state reconciliation ${JSON.stringify(profileStateReport)}.\n`);
} catch (error) {
  process.stderr.write(`Phase 2 migration failed: ${error.code || error.name || 'MIGRATION_FAILED'}${error.report ? ` ${JSON.stringify(error.report)}` : ''}.\n`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

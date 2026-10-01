import mongoose from 'mongoose';
import { migratePlanHealthPersistence } from '../services/planHealthPersistence.js';

const uri = String(process.env.MONGODB_MIGRATION_URI || '').trim();
if (!uri) throw new Error('MONGODB_MIGRATION_URI is required for the explicit Phase 5 Agent Runtime migration.');

try {
  await mongoose.connect(uri, { autoIndex: false });
  const result = await migratePlanHealthPersistence();
  process.stdout.write(`Phase 5 Agent Runtime persistence verified after migration at ${result.verifiedAt}.\n`);
} catch (error) {
  process.stderr.write(`Phase 5 Agent Runtime migration failed: ${error.code || error.name || 'MIGRATION_FAILED'}.\n`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

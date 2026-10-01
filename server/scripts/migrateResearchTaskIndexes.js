import mongoose from 'mongoose';
import { migrateResearchTaskIndexes } from '../services/researchTaskPersistence.js';
import { researchAgentMaxActiveTasks } from '../services/researchTaskCapacity.js';

const uri = String(process.env.MONGODB_MIGRATION_URI || '').trim();
if (!uri) throw new Error('MONGODB_MIGRATION_URI is required for the explicit ResearchAgent task migration.');

try {
  await mongoose.connect(uri, { autoIndex: false });
  const result = await migrateResearchTaskIndexes({ maxActiveTasks: researchAgentMaxActiveTasks(process.env) });
  process.stdout.write(`ResearchAgent task persistence indexes verified at ${result.verifiedAt}.\n`);
} catch (error) {
  process.stderr.write(`ResearchAgent task migration failed: ${error.code || error.name || 'MIGRATION_FAILED'}.\n`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

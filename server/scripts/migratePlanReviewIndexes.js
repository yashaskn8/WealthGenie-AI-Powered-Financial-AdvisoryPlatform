import mongoose from 'mongoose';
import { migratePlanReviewPersistenceIndexes } from '../services/planReviewPersistence.js';

const uri = String(process.env.MONGODB_MIGRATION_URI || '').trim();
if (!uri) throw new Error('MONGODB_MIGRATION_URI is required for the explicit Phase 4 PlanReview index migration.');

try {
  await mongoose.connect(uri, { autoIndex: false });
  const result = await migratePlanReviewPersistenceIndexes();
  process.stdout.write(`Phase 4 PlanReview indexes verified after migration at ${result.verifiedAt}.\n`);
} catch (error) {
  process.stderr.write(`Phase 4 PlanReview index migration failed: ${error.code || error.name || 'MIGRATION_FAILED'}.\n`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { getMongoConnectionOptions } from './mongoCompatibility.js';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

export async function assertMongoTransactionCapability(conn) {
  const hello = await conn.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    const error = new Error(
      'MongoDB must be a replica set because advisory and goal writes require transactions.',
    );
    error.code = 'MONGODB_TRANSACTIONS_REQUIRED';
    throw error;
  }
  return hello.setName;
}

const connectDB = async ({
  uri = process.env.MONGODB_URI,
  retries = MAX_RETRIES,
  options = {},
  env = process.env,
  // Advisory/profile completion and goal writes are transaction-dependent in
  // every environment. Starting against a standalone MongoDB would make the
  // service look healthy and defer the failure until the first user save.
  requireTransactions = true,
} = {}) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(uri, getMongoConnectionOptions(env, options));
      if (requireTransactions) await assertMongoTransactionCapability(conn);
      logger.info('MongoDB connected', { host: conn.connection.host });
      return conn;
    } catch (error) {
      if (attempt === retries) {
        logger.error('MongoDB connection failed after all retries', {
          attempts: retries,
          message: error.message,
        });
        throw error;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn('MongoDB connection attempt failed, retrying', {
        attempt,
        maxRetries: retries,
        nextRetryMs: delay,
        message: error.message,
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export default connectDB;

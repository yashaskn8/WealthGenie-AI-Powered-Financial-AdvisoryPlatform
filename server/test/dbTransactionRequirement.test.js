import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import connectDB, { assertMongoTransactionCapability } from '../config/db.js';

function connectionReturning(hello) {
  return {
    connection: {
      db: {
        admin: () => ({ command: async () => hello }),
      },
    },
  };
}

test('production transaction capability accepts a MongoDB replica set', async () => {
  assert.equal(await assertMongoTransactionCapability(connectionReturning({ setName: 'rs0' })), 'rs0');
});

test('production transaction capability rejects standalone MongoDB', async () => {
  await assert.rejects(
    assertMongoTransactionCapability(connectionReturning({ isWritablePrimary: true })),
    error => error.code === 'MONGODB_TRANSACTIONS_REQUIRED'
      && /replica set.*transactions/i.test(error.message),
  );
});

test('database connection rejects standalone MongoDB by default in every environment', async () => {
  const originalConnect = mongoose.connect;
  mongoose.connect = async () => connectionReturning({ isWritablePrimary: true });

  try {
    await assert.rejects(
      connectDB({
        uri: 'mongodb://127.0.0.1:27017/wealthgenie',
        retries: 1,
        env: { MONGODB_FLAVOR: 'mongodb' },
      }),
      error => error.code === 'MONGODB_TRANSACTIONS_REQUIRED',
    );
  } finally {
    mongoose.connect = originalConnect;
  }
});

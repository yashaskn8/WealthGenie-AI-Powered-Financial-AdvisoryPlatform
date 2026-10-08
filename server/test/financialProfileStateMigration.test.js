import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileLegacyFinancialProfileStates } from '../services/financialProfileStateMigration.js';

function query(value) {
  return { lean: async () => value };
}

function migrationDependencies({ users, profilesByUser = {}, pointersByUser = {} }) {
  const createdStates = [];
  const userModel = { find: () => query(users.map(_id => ({ _id }))) };
  const stateModel = {
    findOne: () => query(null),
    create: async state => {
      createdStates.push(state);
      return state;
    },
  };
  const profileModel = {
    find: filter => query(profilesByUser[String(filter.userId)] || []),
  };
  const recommendationStateModel = {
    find: filter => query(pointersByUser[String(filter.userId)] || []),
  };
  const recommendationModel = { findOne: () => query(null) };
  const revisionModel = { findOne: () => query(null) };
  const auditModel = { findOne: () => query(null) };
  return {
    createdStates,
    dependencies: {
      userModel,
      stateModel,
      profileModel,
      recommendationStateModel,
      recommendationModel,
      revisionModel,
      auditModel,
    },
  };
}

test('ambiguous later legacy graph does not leave earlier users partially reconciled', async () => {
  const { createdStates, dependencies } = migrationDependencies({
    users: ['valid-user', 'ambiguous-user'],
    profilesByUser: {
      'valid-user': [],
      'ambiguous-user': [{ _id: 'profile-1' }],
    },
    pointersByUser: {
      'ambiguous-user': [{
        profileId: 'profile-1',
        currentRecommendationId: 'missing-recommendation',
        currentAllocationRevisionId: 'missing-revision',
        currentAllocationRevision: 1,
      }],
    },
  });

  await assert.rejects(
    reconcileLegacyFinancialProfileStates(dependencies),
    error => error.code === 'FINANCIAL_PROFILE_STATE_LEGACY_AMBIGUOUS',
  );

  assert.deepEqual(createdStates, [{
    userId: 'ambiguous-user',
    currentProfileId: null,
    revision: 0,
    promotionFence: 0,
    resolutionStatus: 'LEGACY_AMBIGUOUS',
  }]);
});

test('unambiguous profileless users are reconciled after the full scan', async () => {
  const { createdStates, dependencies } = migrationDependencies({ users: ['user-a', 'user-b'] });

  const report = await reconcileLegacyFinancialProfileStates(dependencies);

  assert.equal(report.created, 2);
  assert.deepEqual(createdStates.map(state => state.resolutionStatus), ['NO_CURRENT', 'NO_CURRENT']);
  assert.deepEqual(createdStates.map(state => state.revision), [0, 0]);
});


test('late legacy graph read failure causes no earlier state writes', async () => {
  const { createdStates, dependencies } = migrationDependencies({ users: ['valid-user', 'unreadable-user'] });
  const findProfiles = dependencies.profileModel.find;
  dependencies.profileModel.find = filter => {
    if (String(filter.userId) === 'unreadable-user') throw new Error('injected graph read failure');
    return findProfiles(filter);
  };

  await assert.rejects(reconcileLegacyFinancialProfileStates(dependencies), /injected graph read failure/);
  assert.deepEqual(createdStates, []);
});

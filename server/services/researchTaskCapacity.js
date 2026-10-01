import ResearchTaskCapacity from '../models/ResearchTaskCapacity.js';
import { unwrapMongoDocument } from './mongoResult.js';

export const RESEARCH_TASK_CAPACITY_ID = 'research-agent-global';
export const DEFAULT_RESEARCH_AGENT_MAX_ACTIVE_TASKS = 4;
export const MAX_RESEARCH_AGENT_ACTIVE_TASKS = 100;

export function researchAgentMaxActiveTasks(env = process.env) {
  const raw = env.RESEARCH_AGENT_MAX_ACTIVE_TASKS;
  if (raw === undefined || raw === '') return DEFAULT_RESEARCH_AGENT_MAX_ACTIVE_TASKS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESEARCH_AGENT_ACTIVE_TASKS) {
    throw Object.assign(new Error('RESEARCH_AGENT_MAX_ACTIVE_TASKS must be an integer from 1 to 100.'), {
      code: 'RESEARCH_AGENT_CONFIGURATION_INVALID',
      status: 503,
    });
  }
  return value;
}

function capacityError(message = 'Research task distributed capacity is unavailable.') {
  return Object.assign(new Error(message), { code: 'RESEARCH_TASK_CAPACITY_UNAVAILABLE', status: 503 });
}

function leaseMatch(taskId, token, fence, ownerKey) {
  const matches = [
    { $eq: ['$$lease.taskId', { $literal: taskId }] },
    { $eq: ['$$lease.token', { $literal: token }] },
    { $eq: ['$$lease.fence', fence] },
  ];
  if (ownerKey) matches.push({ $eq: ['$$lease.ownerKey', { $literal: ownerKey }] });
  return { $and: matches };
}

export class MongoResearchTaskCapacity {
  constructor({ model = ResearchTaskCapacity, maxActiveTasks = DEFAULT_RESEARCH_AGENT_MAX_ACTIVE_TASKS } = {}) {
    if (!Number.isSafeInteger(maxActiveTasks) || maxActiveTasks < 1 || maxActiveTasks > MAX_RESEARCH_AGENT_ACTIVE_TASKS) {
      throw Object.assign(new Error('Research task capacity limit is invalid.'), { code: 'RESEARCH_AGENT_CONFIGURATION_INVALID', status: 503 });
    }
    this.model = model;
    this.maxActiveTasks = maxActiveTasks;
  }

  async acquire({ taskId, ownerKey, token, fence, leaseMs }) {
    if (typeof taskId !== 'string' || !taskId || typeof ownerKey !== 'string'
        || !/^[a-f0-9]{64}$/.test(ownerKey) || typeof token !== 'string'
        || !Number.isSafeInteger(fence) || fence < 1 || !Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw capacityError('Research task capacity lease identity is invalid.');
    }
    const liveLeases = {
      $filter: {
        input: { $ifNull: ['$activeLeases', []] },
        as: 'lease',
        cond: { $gt: ['$$lease.expiresAt', '$$NOW'] },
      },
    };
    const lease = {
      $mergeObjects: [
        { $literal: { taskId, ownerKey, token, fence } },
        { expiresAt: { $dateAdd: { startDate: '$$NOW', unit: 'millisecond', amount: leaseMs } } },
      ],
    };
    const update = [{
      $set: {
        activeLeases: {
          $let: {
            vars: { live: liveLeases },
            in: {
              $let: {
                vars: {
                  taskLease: {
                    $filter: {
                      input: '$$live',
                      as: 'lease',
                      cond: { $eq: ['$$lease.taskId', { $literal: taskId }] },
                    },
                  },
                },
                in: {
                  $cond: [
                    {
                      $and: [
                        { $lt: [{ $size: '$$live' }, '$maxActiveTasks'] },
                        { $eq: [{ $size: '$$taskLease' }, 0] },
                      ],
                    },
                    { $concatArrays: ['$$live', [lease]] },
                    '$$live',
                  ],
                },
              },
            },
          },
        },
        updatedAt: '$$NOW',
      },
    }];
    let document;
    try {
      document = unwrapMongoDocument(await this.model.collection.findOneAndUpdate(
        { _id: RESEARCH_TASK_CAPACITY_ID, maxActiveTasks: this.maxActiveTasks },
        update,
        { returnDocument: 'after' },
      ));
    } catch {
      throw capacityError();
    }
    if (!document) throw capacityError('Research task capacity state is missing or mismatched; run the explicit ResearchTask migration.');
    const taskLease = (document.activeLeases || []).find(item => item.taskId === taskId);
    if (taskLease?.token === token && taskLease.fence === fence) {
      return { acquired: true, sameTaskHeld: false, expiresAt: taskLease.expiresAt };
    }
    if (taskLease) return { acquired: false, sameTaskHeld: true };
    return { acquired: false, sameTaskHeld: false };
  }

  async renew({ taskId, ownerKey, token, fence, leaseMs }) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) return false;
    try {
      const result = unwrapMongoDocument(await this.model.collection.findOneAndUpdate({
        _id: RESEARCH_TASK_CAPACITY_ID,
        $expr: {
          $gt: [{
            $size: {
              $filter: {
                input: { $ifNull: ['$activeLeases', []] },
                as: 'lease',
                cond: { $and: [leaseMatch(taskId, token, fence, ownerKey), { $gt: ['$$lease.expiresAt', '$$NOW'] }] },
              },
            },
          }, 0],
        },
      }, [{
        $set: {
          activeLeases: {
            $map: {
              input: '$activeLeases',
              as: 'lease',
              in: {
                $cond: [
                  leaseMatch(taskId, token, fence, ownerKey),
                  { $mergeObjects: ['$$lease', { expiresAt: { $dateAdd: { startDate: '$$NOW', unit: 'millisecond', amount: leaseMs } } }] },
                  '$$lease',
                ],
              },
            },
          },
          updatedAt: '$$NOW',
        },
      }], { returnDocument: 'after' }));
      return result?.activeLeases?.find(item => (
        item.taskId === taskId && item.ownerKey === ownerKey && item.token === token && item.fence === fence
      ))?.expiresAt || null;
    } catch {
      throw capacityError();
    }
  }

  async release({ taskId, ownerKey, token, fence }) {
    try {
      const result = unwrapMongoDocument(await this.model.collection.findOneAndUpdate(
        { _id: RESEARCH_TASK_CAPACITY_ID },
        [{
          $set: {
            activeLeases: {
              $filter: {
                input: { $ifNull: ['$activeLeases', []] },
                as: 'lease',
                cond: { $not: [leaseMatch(taskId, token, fence, ownerKey)] },
              },
            },
            updatedAt: '$$NOW',
          },
        }],
        { returnDocument: 'after' },
      ));
      return Boolean(result);
    } catch {
      throw capacityError();
    }
  }
}

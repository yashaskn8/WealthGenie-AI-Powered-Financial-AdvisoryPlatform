import 'dotenv/config';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import FinancialProfile from '../models/FinancialProfile.js';
import {
  buildRecommendationProfile,
  FINANCIAL_PROFILE_SCHEMA_VERSION,
  toProfilePersistence,
} from '../services/recommendationProfile.js';
import { assessSuitabilityRisk } from '../services/riskProfiler.js';

const EQUIVALENT_ALIASES = Object.freeze({
  monthlyTakeHome: ['monthlyTakeHome', 'monthly_take_home', 'monthlyIncome', 'monthly_income'],
  monthlySavings: ['monthlySavings', 'savings', 'monthly_savings'],
  age: ['age'],
  riskTolerance: ['riskTolerance', 'risk_tolerance'],
  soldPropertyProceeds: ['soldPropertyProceeds', 'soldPropertyAmount', 'sold_property_proceeds', 'sold_property_amount'],
  hasLumpSum: ['hasLumpSum', 'has_lump_sum'],
  lumpSumAmount: ['lumpSumAmount', 'lump_sum_amount'],
  liquidSavings: ['liquidSavings', 'liquid_savings'],
  emiBurdenPct: ['emiBurdenPct', 'emi_burden_pct', 'existing_debt_emi_ratio_pct'],
  financialDependents: ['financialDependents', 'financial_dependents', 'dependents'],
  emergencyFundMonths: ['emergencyFundMonths', 'emergency_fund_months'],
  investmentGoals: ['investmentGoals', 'investment_goals', 'goals'],
  investmentHorizonYears: ['investmentHorizonYears', 'investment_horizon_years', 'investmentHorizon', 'investment_horizon'],
});

export const NEVER_INFER_FROM = Object.freeze([
  'annualIncome', 'totalCTC', 'basicComponent', 'existingDebt', 'existing_debt',
  'goal_type', 'investableAmount', 'oneTimeInvestableAmount',
]);

function firstDefined(record, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)
        && record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

/**
 * Builds a migration plan using only semantically equivalent aliases. The
 * canonical boundary performs conflict and range validation; missing facts are
 * reported for manual remediation instead of being guessed.
 */
export function planFinancialProfileMigration(record) {
  const candidate = {};
  for (const [canonical, aliases] of Object.entries(EQUIVALENT_ALIASES)) {
    candidate[canonical] = firstDefined(record, aliases);
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(record, alias)) candidate[alias] = record[alias];
    }
  }

  try {
    const profile = buildRecommendationProfile(candidate);
    const suitability = assessSuitabilityRisk(profile);
    return {
      status: record.recommendationProfileVersion === FINANCIAL_PROFILE_SCHEMA_VERSION
        ? 'already_current'
        : 'ready',
      profileId: String(record._id),
      set: toProfilePersistence(profile, suitability),
      ignoredNonEquivalentFields: NEVER_INFER_FROM.filter(field => (
        Object.prototype.hasOwnProperty.call(record, field)
      )),
    };
  } catch (error) {
    return {
      status: 'manual_remediation_required',
      profileId: String(record._id),
      errors: error.details || [error.message],
      ignoredNonEquivalentFields: NEVER_INFER_FROM.filter(field => (
        Object.prototype.hasOwnProperty.call(record, field)
      )),
    };
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri);
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    schemaVersion: FINANCIAL_PROFILE_SCHEMA_VERSION,
    scanned: 0,
    ready: 0,
    updated: 0,
    alreadyCurrent: 0,
    manualRemediationRequired: 0,
    records: [],
  };

  try {
    const cursor = FinancialProfile.collection.find({});
    for await (const record of cursor) {
      report.scanned += 1;
      const plan = planFinancialProfileMigration(record);
      if (plan.status === 'manual_remediation_required') {
        report.manualRemediationRequired += 1;
        report.records.push(plan);
        continue;
      }
      if (plan.status === 'already_current') {
        report.alreadyCurrent += 1;
        continue;
      }
      report.ready += 1;
      if (apply) {
        await FinancialProfile.collection.updateOne(
          { _id: record._id },
          { $set: plan.set },
        );
        report.updated += 1;
      }
    }
  } finally {
    await mongoose.disconnect();
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.manualRemediationRequired > 0) process.exitCode = 2;
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
if (invokedDirectly) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

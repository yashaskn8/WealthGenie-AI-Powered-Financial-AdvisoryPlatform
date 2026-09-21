import { sipFV, lumpSumFV } from './projectionEngine.js';

/**
 * Independent Arithmetic Verification Engine
 * Analyzes LLM text output for numerical financial claims (SIP calculations, Lump Sum growth, Required SIP),
 * recomputes them using single-source-of-truth financial engines, and appends a correction if outside tolerance.
 *
 * @param {string} textText
 * @param {object} profile
 * @param {number} [tolerancePct=0.02] 2% tolerance threshold
 * @returns {{ verifiedText: string, verificationMetadata: object }}
 */
export function verifyAndCorrectArithmetic(textText, profile = {}, tolerancePct = 0.02) {
  if (!textText || typeof textText !== 'string') {
    return {
      verifiedText: textText || '',
      verificationMetadata: {
        verification_status: 'unverified',
        verified_fields: [],
        corrected_fields: [],
        verification_time_ms: 0,
      },
    };
  }

  const startTime = Date.now();
  let verifiedText = textText;
  const verifiedFields = [];
  const correctedFields = [];
  const correctionsToAppend = [];

  // Pattern 1: Monthly SIP calculation claim
  // e.g., "monthly SIP of ₹10,000 for 10 years at 12% annual return will yield ₹23.2 Lakhs"
  const sipRegex = /(?:monthly\s+SIP|investing|save[s]?)\s+of\s+₹?\s*([\d,]+)\s*(?:\/month|per\s+month)?\s+for\s+([\d.]+)\s*years?\s+at\s+([\d.]+)\s*%\s*(?:annual\s*return|CAGR)?(?:[^\n]*?(?:yield|grow|accumulate|reach|total[s]?)\s*(?:to\s*)?₹?\s*([\d,.]+)\s*(Lakhs?|Cr|Crores?)?)/gi;

  let match;
  while ((match = sipRegex.exec(textText)) !== null) {
    const rawMonthlySip = parseFloat(match[1].replace(/,/g, ''));
    const years = parseFloat(match[2]);
    const annualRatePct = parseFloat(match[3]);
    const claimedValueRaw = parseFloat(match[4].replace(/,/g, ''));
    const unit = match[5] ? match[5].toLowerCase() : null;

    if (Number.isFinite(rawMonthlySip) && Number.isFinite(years) && Number.isFinite(annualRatePct) && Number.isFinite(claimedValueRaw)) {
      let claimedValue = claimedValueRaw;
      if (unit && unit.startsWith('lakh')) {
        claimedValue *= 100000;
      } else if (unit && (unit.startsWith('cr') || unit.startsWith('crore'))) {
        claimedValue *= 10000000;
      }

      // Recompute using verified sipFV engine formula (single source of truth)
      const annualRate = annualRatePct / 100;
      const expectedFV = sipFV(rawMonthlySip, annualRate, years);

      const diffRatio = Math.abs(claimedValue - expectedFV) / Math.max(expectedFV, 1);

      if (diffRatio <= tolerancePct) {
        verifiedFields.push({
          field: 'SIP_FUTURE_VALUE',
          claimed: claimedValue,
          verified: expectedFV,
          withinTolerance: true,
        });
      } else {
        const formattedExpected = formatIndianCurrency(expectedFV);
        const formattedClaimed = formatIndianCurrency(claimedValue);

        correctedFields.push({
          field: 'SIP_FUTURE_VALUE',
          claimed: claimedValue,
          verified: expectedFV,
          diffRatio,
        });

        correctionsToAppend.push(
          `*Verified Financial Calculation:* A monthly SIP of ₹${rawMonthlySip.toLocaleString('en-IN')} at ${annualRatePct}% p.a. over ${years} years actually yields ${formattedExpected} rather than ${formattedClaimed}.`
        );
      }
    }
  }

  // Pattern 2: Lump Sum Compound Interest claim
  // e.g., "lump sum of ₹1,000,000 for 5 years at 10% annual return will grow to ₹1,610,510"
  const lumpSumRegex = /(?:lump\s*sum|one-time\s+investment)\s+of\s+₹?\s*([\d,]+)\s+for\s+([\d.]+)\s*years?\s+at\s+([\d.]+)\s*%\s*(?:annual\s*return|CAGR)?(?:[^\n]*?(?:grow|accumulate|reach|total[s]?)\s*(?:to\s*)?₹?\s*([\d,.]+)\s*(Lakhs?|Cr|Crores?)?)/gi;

  while ((match = lumpSumRegex.exec(textText)) !== null) {
    const principal = parseFloat(match[1].replace(/,/g, ''));
    const years = parseFloat(match[2]);
    const annualRatePct = parseFloat(match[3]);
    const claimedValueRaw = parseFloat(match[4].replace(/,/g, ''));
    const unit = match[5] ? match[5].toLowerCase() : null;

    if (Number.isFinite(principal) && Number.isFinite(years) && Number.isFinite(annualRatePct) && Number.isFinite(claimedValueRaw)) {
      let claimedValue = claimedValueRaw;
      if (unit && unit.startsWith('lakh')) claimedValue *= 100000;
      else if (unit && (unit.startsWith('cr') || unit.startsWith('crore'))) claimedValue *= 10000000;

      // Recompute using verified lumpSumFV engine formula (single source of truth)
      const expectedFV = lumpSumFV(principal, annualRatePct / 100, years);
      const diffRatio = Math.abs(claimedValue - expectedFV) / Math.max(expectedFV, 1);

      if (diffRatio <= tolerancePct) {
        verifiedFields.push({ field: 'LUMP_SUM_FUTURE_VALUE', claimed: claimedValue, verified: expectedFV, withinTolerance: true });
      } else {
        const formattedExpected = formatIndianCurrency(expectedFV);
        const formattedClaimed = formatIndianCurrency(claimedValue);
        correctedFields.push({ field: 'LUMP_SUM_FUTURE_VALUE', claimed: claimedValue, verified: expectedFV, diffRatio });
        correctionsToAppend.push(
          `*Verified Financial Calculation:* A lump sum of ₹${principal.toLocaleString('en-IN')} at ${annualRatePct}% p.a. over ${years} years grows to ${formattedExpected} rather than ${formattedClaimed}.`
        );
      }
    }
  }

  // Appending visible corrections if any field failed tolerance
  if (correctionsToAppend.length > 0) {
    verifiedText = verifiedText.trim() + '\n\n' + correctionsToAppend.join('\n');
  }

  const status = correctedFields.length > 0
    ? 'corrected'
    : (verifiedFields.length > 0 ? 'verified' : 'unverified');

  const verificationMetadata = {
    verification_status: status,
    verified_fields: verifiedFields,
    corrected_fields: correctedFields,
    verification_time_ms: Date.now() - startTime,
  };

  return { verifiedText, verificationMetadata };
}

function formatIndianCurrency(val) {
  if (val >= 10000000) {
    return `₹${(val / 10000000).toFixed(2)} Cr`;
  }
  if (val >= 100000) {
    return `₹${(val / 100000).toFixed(2)} Lakhs`;
  }
  return `₹${Math.round(val).toLocaleString('en-IN')}`;
}

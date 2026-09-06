import axios from 'axios';
import { getCache, setCache } from '../config/redis.js';
import crypto from 'crypto';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = 'openai/gpt-oss-120b';
const GEMINI_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

function hashProfile(profile) {
  return crypto.createHash('md5').update(JSON.stringify(profile)).digest('hex');
}

export async function generateAdvisory(userContext) {
  const { profile, instruments, shapExplanation } = userContext;
  const cacheKey = `advisory:${hashProfile(userContext)}`;

  // Check Redis cache (1 hour TTL)
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  if (!profile || !Number.isFinite(profile.monthlyTakeHome) || !Number.isFinite(profile.monthlySavings)) {
    throw new TypeError('generateAdvisory requires canonical Financial Profile context');
  }
  const instrumentList = (instruments || []).map(i => `${i.name} (${i.type}) - nominal expected return: ${i.nominalReturn}% - allocation: ${(i.allocationWeight * 100).toFixed(1)}%`).join('\n  ');

  // Build SHAP context block if available
  let shapContext = '';
  if (shapExplanation && shapExplanation.feature_contributions) {
    const contributions = shapExplanation.feature_contributions
      .map(c => `${c.display_name}: ${c.direction} recommendation by ${c.magnitude}`)
      .join(', ');
    shapContext = `\n\nML Model Reasoning:\nThe AI model's top reason for this recommendation was: ${shapExplanation.top_reason}\nThe feature contributions in order of importance were: ${contributions}.\nIncorporate this reasoning naturally into your advisory paragraph. Do not use technical jargon like 'SHAP values'. Write as if you are a human financial advisor explaining your logic.`;
  }

  const prompt = `You are a certified Indian financial advisor. Based on the following investor profile, write a 3-paragraph advisory note (under 300 words total):

Investor Financial Profile (the complete and only approved personalization context):
- Age: ${profile.age} years
- Monthly take-home: ₹${profile.monthlyTakeHome.toLocaleString('en-IN')}
- Monthly savings capacity: ₹${profile.monthlySavings.toLocaleString('en-IN')}
- Stated risk tolerance: ${profile.riskTolerance}
- Final suitability risk: ${profile.suitabilityRisk}
- Investment horizon: ${profile.investmentHorizonYears} years
- Emergency-fund coverage: ${profile.emergencyFundMonths} months
- EMI burden: ${profile.emiBurdenPct}%
- Financial dependents: ${profile.financialDependents}
- Goals: ${profile.investmentGoals.join(', ')}
- Deployable one-time lump sum: ₹${profile.deployableLumpSum.toLocaleString('en-IN')}

Top 3 Recommended Instruments:
  ${instrumentList}
${shapContext}
Instructions:
Paragraph 1: Explain WHY these specific instruments suit this investor's approved profile and final suitability ceiling.
Paragraph 2: Highlight 2-3 KEY RISKS the investor should be aware of.
Paragraph 3: Provide ONE specific, actionable next step the investor should take immediately.

Use simple English. Reference specific numbers from the profile. Do not infer annual/gross income, CTC, tax slab, deductions, property availability, family facts, or any missing financial fact. Returns are pre-tax nominal estimates, not personalized post-tax yields. Do not use bullet points. Keep it warm and professional.`;

  let text = '';
  let fallbackUsed = false;
  let modelUsed = '';

  // ── Attempt 1: Gemini (Primary) ──
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await axios.post(GEMINI_CHAT_URL, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
      }, {
        timeout: 15000,
        headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
      });
      text = res.data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('');
      if (text) {
        modelUsed = 'Gemini 3.6 Flash';
      }
    } catch (geminiErr) {
      console.warn('[Advisory] Primary Gemini API failed, falling back to Groq:', geminiErr.message);
    }
  }

  // ── Attempt 2: Groq (Secondary Fallback) ──
  if (!text) {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      try {
        const response = await axios.post(GROQ_API_URL, {
          model: MODEL_NAME,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048,
          temperature: 0.7
        }, {
          timeout: 15000,
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json'
          }
        });
        text = response.data?.choices?.[0]?.message?.content;
        if (text) {
          modelUsed = 'Groq Llama 3.3';
        }
      } catch (groqErr) {
        console.error('[Advisory] Fallback Groq API also failed:', groqErr.message);
      }
    }
  }

  // ── Attempt 3: Rule-Based Fallback ──
  if (!text) {
    text = getFallbackAdvisory(userContext);
    fallbackUsed = true;
    modelUsed = 'Rule-based Static Fallback';
  }

  const result = {
    text,
    cached: false,
    generatedAt: new Date().toISOString(),
    fallback: fallbackUsed,
    modelUsed,
  };

  // Cache for 1 hour if it wasn't a total static fallback (to allow retries later if keys are configured)
  if (!fallbackUsed) {
    await setCache(cacheKey, result, 3600);
  }
  return result;
}

function getFallbackAdvisory({ profile, instruments }) {
  const safeInstruments = Array.isArray(instruments) ? instruments : [];
  const topInst = safeInstruments[0]?.name || 'diversified instruments';
  return `Based on your approved profile as a ${profile.age}-year-old investor with ${profile.suitabilityRisk} final suitability, ${topInst} aligns with your selected goals and ${profile.investmentHorizonYears}-year horizon. Expected returns shown are pre-tax nominal estimates because taxable income and deductions are not part of the Financial Profile.\n\nKey risks include market volatility, interest-rate changes, liquidity constraints, and inflation. The allocation is kept within your stated preference and measured capacity, but actual returns can differ materially from estimates.\n\nAs an immediate next step, review the proposed allocation and start only an amount within your ₹${profile.monthlySavings.toLocaleString('en-IN')} monthly savings capacity.`;
}

export async function getGoalAdvisory(message, profileContext) {
  const systemPrompt = `You are WealthGenie, an educational financial-planning assistant for Indian retail investors. Approved context: age ${profileContext.age}, monthly take-home INR ${profileContext.monthlyTakeHome}, monthly savings INR ${profileContext.monthlySavings}, final suitability ${profileContext.suitabilityRisk}, horizon ${profileContext.investmentHorizonYears} years. The custom goal name and target are planning inputs only and must not modify the Financial Profile or suitability. Do not infer gross income, CTC, tax slab, deductions, or missing family facts. Answer concisely in 2-3 sentences.`;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await axios.post(GEMINI_CHAT_URL, {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.6 }
      }, {
        timeout: 15000,
        headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
      });
      const text = res.data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('');
      if (text) return text;
    } catch (geminiErr) {
      console.warn('[getGoalAdvisory] Primary Gemini API failed, falling back to Groq:', geminiErr.response?.data || geminiErr.message);
    }
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const res = await axios.post(GROQ_API_URL, {
        model: MODEL_NAME,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        max_tokens: 300,
        temperature: 0.6
      }, {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json'
        }
      });
      const text = res.data?.choices?.[0]?.message?.content;
      if (text) return text;
    } catch (groqErr) {
      console.error('[getGoalAdvisory] Fallback Groq API also failed:', groqErr.response?.data || groqErr.message);
    }
  }

  return 'Live AI advice is temporarily unavailable. Keep the goal SIP on schedule, review the allocation in the goal planner, and try refreshing advice again shortly.';
}

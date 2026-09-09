/**
 * WealthGenie architecture/documentation integrity checker.
 *
 * This checks current authority boundaries rather than preserving retired
 * chat-orchestration claims in documentation.
 */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const files = {
  readme: path.join(ROOT_DIR, 'README.md'),
  chat: path.join(ROOT_DIR, 'server', 'services', 'geminiChatService.js'),
  explanation: path.join(ROOT_DIR, 'server', 'services', 'groundedExplanationService.js'),
  validator: path.join(ROOT_DIR, 'server', 'services', 'groundingValidator.js'),
  providers: path.join(ROOT_DIR, 'server', 'services', 'providerAbstraction.js'),
  mlMain: path.join(ROOT_DIR, 'ml-service', 'main.py'),
  mlSecurity: path.join(ROOT_DIR, 'ml-service', 'security.py'),
};

console.log('='.repeat(70));
console.log('WealthGenie Architecture & Documentation Sync Checker');
console.log('='.repeat(70));

let failures = 0;

function assertFileExists(filePath, name) {
  if (!fs.existsSync(filePath)) {
    console.error(`[FAIL] Required file missing: ${name} (${filePath})`);
    failures += 1;
    return false;
  }
  console.log(`[PASS] Found ${name}`);
  return true;
}

function assertMatches(filePath, pattern, description) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  if (!pattern.test(content)) {
    console.error(`[FAIL] Architecture mismatch: ${description} in ${path.basename(filePath)}`);
    failures += 1;
  } else {
    console.log(`[PASS] Verified ${description}`);
  }
}

function assertDoesNotMatch(filePath, pattern, description) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  if (pattern.test(content)) {
    console.error(`[FAIL] Retired architecture remains: ${description} in ${path.basename(filePath)}`);
    failures += 1;
  } else {
    console.log(`[PASS] Verified absence of ${description}`);
  }
}

for (const [name, filePath] of Object.entries(files)) assertFileExists(filePath, name);

assertMatches(files.chat, /buildChatEvidencePacket[\s\S]*generateGroundedExplanation/, 'chat builds evidence then requests a grounded explanation');
assertDoesNotMatch(files.chat, /queryRAG|ragClient|intentGate|aiToolOrchestrator/, 'retired RAG/tool-routing financial authority');
assertMatches(files.explanation, /GROUNDED_LLM_TOOL_ALLOWLIST\s*=\s*Object\.freeze\(\[\]\)/, 'LLM tool allowlist is empty');
assertMatches(files.explanation, /validateGroundedExplanation/, 'LLM output is validated against its evidence packet');
assertMatches(files.explanation, /DETERMINISTIC_TEMPLATE/, 'validated deterministic explanation fallback remains available');
assertMatches(files.providers, /NvidiaNimProviderAdapter/, 'NVIDIA NIM adapter exists behind the provider abstraction');
assertMatches(files.mlSecurity, /env_mode\s+not\s+in\s+LOCAL_ENVIRONMENTS/, 'ML service authentication fails closed outside local environments');

assertMatches(files.readme, /Express is the authoritative boundary/, 'README identifies Express as financial authority');
assertMatches(files.readme, /NVIDIA NIM[^\n]*grounded explanation/i, 'README limits NVIDIA NIM to grounded explanation');
assertMatches(files.readme, /HMM[^\n]*shadow/i, 'README identifies HMM as shadow-only');
assertMatches(files.readme, /deterministic market-context policy[^\n]*champion/i, 'README identifies the deterministic market policy as champion');
assertMatches(files.readme, /replicaSet=rs0/, 'README documents the replica-set requirement');
assertDoesNotMatch(files.readme, /Express\.js Gateway \(IntentGate\)|routes factual[^\n]+FastAPI RAG|Multi-Agent Conversational System|Ranks catalog product candidates/, 'stale gateway, multi-agent, or catalog-ranking claims');

console.log('='.repeat(70));
if (failures > 0) {
  console.error(`FAILED: ${failures} architecture sync checks failed.`);
  process.exit(1);
}
console.log('SUCCESS: documented authority boundaries match the implementation.');

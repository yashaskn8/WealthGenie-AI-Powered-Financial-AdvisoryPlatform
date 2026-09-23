import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const testDir = path.join(serverDir, 'test');
const mode = process.argv[2];
const mongoManifestPath = path.join(scriptDir, 'mongo-required-tests.json');
const mongoManifest = JSON.parse(await readFile(mongoManifestPath, 'utf8'));

async function collectTestFiles(directory, relativeTo = serverDir) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTestFiles(absolutePath, relativeTo);
    if (!entry.isFile() || !entry.name.endsWith('.test.js')) return [];
    return [path.relative(relativeTo, absolutePath).split(path.sep).join('/')];
  }));
  return nested.flat().sort();
}

const testFiles = await collectTestFiles(testDir);
const mongoDependencyPatterns = [
  /\bsetupTestDatabase\s*\(/,
  /\bmongoTestHelper\b/,
  /\bmongoose\.connect\s*\(/,
  /\bMongoClient\.connect\s*\(/,
  /\b(?:MongoMemoryServer|MongoMemoryReplSet|MongoDBContainer)\b/,
  /\brequireReplicaSet\s*[:=]/,
];
const mongoRequired = [];
for (const file of testFiles) {
  const source = await readFile(path.join(serverDir, file), 'utf8');
  if (mongoDependencyPatterns.some(pattern => pattern.test(source))) {
    mongoRequired.push(file);
  }
}

const expectedMongo = [...mongoManifest].sort();
const manifestMatches = JSON.stringify(mongoRequired) === JSON.stringify(expectedMongo);
if (!manifestMatches) {
  console.error('Mongo test partition manifest is stale.');
  console.error(`Detected: ${JSON.stringify(mongoRequired)}`);
  console.error(`Manifest: ${JSON.stringify(expectedMongo)}`);
  process.exit(1);
}

if (mode === 'verify') {
  const packageJson = JSON.parse(await readFile(path.join(serverDir, 'package.json'), 'utf8'));
  const fullSuiteScripts = ['test', 'test:unit', 'test:coverage', 'test:coverage:unit'];
  const scriptsUseFullPartition = fullSuiteScripts.every(scriptName => {
    const command = packageJson.scripts?.[scriptName] || '';
    return /\bnode\s+scripts\/test-partition\.js\s+full(?:\s|$)/.test(command);
  });
  if (!scriptsUseFullPartition) {
    console.error('All backend test scripts must select the full explicit *.test.js partition.');
    process.exit(1);
  }
  console.log(`Mongo partition verified: ${mongoRequired.length} Mongo-required suites are included in the full Node test selection.`);
  process.exit(0);
}

if (mode === 'full') {
  console.log(`Running the full backend suite: ${testFiles.length} explicit *.test.js files.`);
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], {
    cwd: serverDir,
    env: process.env,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

if (mode !== 'no-mongo') {
  console.error('Usage: node scripts/test-partition.js <verify|full|no-mongo>');
  process.exit(2);
}

const selected = testFiles.filter(file => !expectedMongo.includes(file));
const accidentalMongoTests = selected.filter(file => expectedMongo.includes(file));
if (selected.length === 0 || accidentalMongoTests.length > 0) {
  console.error('No-Mongo test selection is empty or contains a Mongo-required suite.');
  process.exit(1);
}

const env = { ...process.env };
delete env.MONGODB_URI;
delete env.MONGO_URI;
env.MONGO_TEST_PARTITION = 'NO_MONGO';
env.USE_MMS = 'false';
env.USE_TESTCONTAINERS = 'false';
console.log(`Running ${selected.length} tests without MongoDB; excluding ${expectedMongo.length} Mongo-required suites.`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...selected], {
  cwd: serverDir,
  env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);

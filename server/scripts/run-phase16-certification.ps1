param(
    [switch]$TestPathComparison,
    [switch]$TestOfflineTestSummaryParser
)

$ErrorActionPreference = 'Stop'
$repoExpected = 'C:\Users\prana\OneDrive\Desktop\wealthgenie trial'
$remoteExpected = 'https://github.com/yashaskn8/WealthGenie-AI-Powered-Financial-AdvisoryPlatform.git'
$datasetHashExpected = '9E055D3827EE34C632D32F32CA41CE7F40726E51BC657728CE488B0812B942DB'
function ConvertTo-CanonicalPathForComparison {
    param([Parameter(Mandatory)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    if ([System.String]::Equals($fullPath, $pathRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $pathRoot
    }

    return $fullPath.TrimEnd([char[]]@('\', '/'))
}

function Test-CanonicalPathEqual {
    param(
        [Parameter(Mandatory)][string]$FirstPath,
        [Parameter(Mandatory)][string]$SecondPath
    )

    $firstCanonical = ConvertTo-CanonicalPathForComparison $FirstPath
    $secondCanonical = ConvertTo-CanonicalPathForComparison $SecondPath
    return [System.String]::Equals($firstCanonical, $secondCanonical, [System.StringComparison]::OrdinalIgnoreCase)
}

function ConvertFrom-NodeTapSummary {
    param([AllowEmptyString()][string]$Output)

    $counts = @{
        tests = $null
        pass = $null
        fail = $null
        cancelled = $null
        skipped = $null
    }
    foreach ($field in @('tests', 'pass', 'fail', 'cancelled', 'skipped')) {
        $pattern = '(?m)^# ' + [System.Text.RegularExpressions.Regex]::Escape($field) + '[ \t]+([0-9]+)[ \t]*\r?$'
        $lineMatches = [System.Text.RegularExpressions.Regex]::Matches($Output, $pattern)
        if ($lineMatches.Count -ne 1) {
            return [PSCustomObject]@{
                Valid = $false
                Code = 'OFFLINE_TEST_SUMMARY_UNAVAILABLE'
                Tests = $counts.tests
                Passed = $counts.pass
                Failed = $counts.fail
                Cancelled = $counts.cancelled
                Skipped = $counts.skipped
            }
        }

        $count = 0L
        if (-not [long]::TryParse($lineMatches[0].Groups[1].Value, [ref]$count)) {
            return [PSCustomObject]@{
                Valid = $false
                Code = 'OFFLINE_TEST_SUMMARY_UNAVAILABLE'
                Tests = $counts.tests
                Passed = $counts.pass
                Failed = $counts.fail
                Cancelled = $counts.cancelled
                Skipped = $counts.skipped
            }
        }
        $counts[$field] = $count
    }

    if ($counts.tests -le 0) {
        $code = 'OFFLINE_TESTS_ZERO_EXECUTED'
    } elseif ($counts.fail -gt 0 -or $counts.cancelled -gt 0) {
        $code = 'OFFLINE_TESTS_FAILED'
    } elseif (($counts.pass + $counts.fail + $counts.cancelled + $counts.skipped) -ne $counts.tests) {
        $code = 'OFFLINE_TEST_SUMMARY_INCONSISTENT'
    } else {
        $code = $null
    }

    return [PSCustomObject]@{
        Valid = ($null -eq $code)
        Code = $code
        Tests = $counts.tests
        Passed = $counts.pass
        Failed = $counts.fail
        Cancelled = $counts.cancelled
        Skipped = $counts.skipped
    }
}

if ($TestPathComparison) {
    $expectedPath = ConvertTo-CanonicalPathForComparison $repoExpected
    $forwardSlashPath = $expectedPath.Replace('\', '/').TrimEnd('/') + '/'
    $backwardSlashPath = $expectedPath.TrimEnd('\') + '\'
    $wrongRoot = Join-Path (Split-Path $expectedPath -Parent) 'wealthgenie trial-wrong-root'
    $actualGitRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel | Select-Object -First 1).Trim()

    if (-not (Test-CanonicalPathEqual $expectedPath $forwardSlashPath)) { throw 'FORWARD_SLASH_PATH_REGRESSION_FAILED' }
    if (-not (Test-CanonicalPathEqual $expectedPath $backwardSlashPath)) { throw 'BACKWARD_SLASH_PATH_REGRESSION_FAILED' }
    if (-not (Test-CanonicalPathEqual $expectedPath $expectedPath.ToUpperInvariant())) { throw 'CASE_INSENSITIVE_PATH_REGRESSION_FAILED' }
    if (-not (Test-CanonicalPathEqual $expectedPath $actualGitRoot)) { throw 'ACTUAL_GIT_ROOT_PATH_REGRESSION_FAILED' }
    if (Test-CanonicalPathEqual $expectedPath $wrongRoot) { throw 'WRONG_ROOT_PATH_REGRESSION_FAILED' }

    Write-Output 'PHASE16_PATH_COMPARISON_TESTS_PASS'
    return
}

if ($TestOfflineTestSummaryParser) {
    $validSummary = ConvertFrom-NodeTapSummary @'
TAP version 13
1..4
ok 1 - one
ok 2 - two
ok 3 - three
ok 4 - four
# tests 4
# pass 4
# fail 0
# cancelled 0
# skipped 0
'@
    if (-not $validSummary.Valid -or $validSummary.Tests -ne 4 -or $validSummary.Passed -ne 4) {
        throw 'TAP_VALID_SUMMARY_REGRESSION_FAILED'
    }

    $malformedSummary = ConvertFrom-NodeTapSummary @'
# tests 2
# pass 2
# fail 0
# cancelled 0
'@
    if ($malformedSummary.Valid -or $malformedSummary.Code -ne 'OFFLINE_TEST_SUMMARY_UNAVAILABLE') {
        throw 'TAP_MALFORMED_SUMMARY_REGRESSION_FAILED'
    }

    $zeroSummary = ConvertFrom-NodeTapSummary @'
# tests 0
# pass 0
# fail 0
# cancelled 0
# skipped 0
'@
    if ($zeroSummary.Valid -or $zeroSummary.Code -ne 'OFFLINE_TESTS_ZERO_EXECUTED') {
        throw 'TAP_ZERO_TEST_REGRESSION_FAILED'
    }

    $failedSummary = ConvertFrom-NodeTapSummary @'
# tests 2
# pass 1
# fail 1
# cancelled 0
# skipped 0
'@
    if ($failedSummary.Valid -or $failedSummary.Code -ne 'OFFLINE_TESTS_FAILED') {
        throw 'TAP_FAILED_TEST_REGRESSION_FAILED'
    }

    $cancelledSummary = ConvertFrom-NodeTapSummary @'
# tests 1
# pass 0
# fail 0
# cancelled 1
# skipped 0
'@
    if ($cancelledSummary.Valid -or $cancelledSummary.Code -ne 'OFFLINE_TESTS_FAILED') {
        throw 'TAP_CANCELLED_TEST_REGRESSION_FAILED'
    }

    Write-Output 'PHASE16_TAP_SUMMARY_PARSER_TESTS_PASS'
    return
}

$repoRoot = ConvertTo-CanonicalPathForComparison (Join-Path $PSScriptRoot '..\..')
$serverRoot = Join-Path $repoRoot 'server'
$failureCode = 'PHASE16_CERTIFICATION_PREFLIGHT_FAILED'
$phase = 'REPOSITORY_VERIFICATION'
$report = $null
$offlineTestDiagnostics = $null
$resultExitCode = 1
$envNames = @(
    'GROQ_API_KEY', 'GROQ_MODEL', 'GEMINI_API_KEY', 'NVIDIA_API_KEY',
    'LLM_PRIMARY_PROVIDER', 'LLM_GEMINI_FALLBACK_ENABLED', 'LLM_DEFAULT_PROVIDER',
    'RUN_AGENT_LIVE_EVALS', 'PLAN_REVIEW_LIVE_EVAL_CASE_ID'
)
$savedEnvironment = @{}
foreach ($name in $envNames) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Invoke-GitText {
    param([string[]]$GitArgs)
    $output = & git -C $repoRoot @GitArgs
    if ($LASTEXITCODE -ne 0) { throw 'GIT_VERIFICATION_FAILED' }
    return @($output | ForEach-Object { [string]$_ })
}

function Get-WorktreeSnapshot {
    $status = Invoke-GitText @('status', '--porcelain=v1', '--untracked-files=all')
    $stashes = Invoke-GitText @('stash', 'list')
    return [PSCustomObject]@{
        Status = [string]::Join("`n", $status)
        DirtyPathCount = @($status | Where-Object { $_.Length -ge 4 }).Count
        Stashes = [string]::Join("`n", $stashes)
    }
}

try {
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }

    if (-not (Test-CanonicalPathEqual $repoRoot $repoExpected)) { throw 'CANONICAL_PATH_MISMATCH' }
    $gitRoot = (Invoke-GitText @('rev-parse', '--show-toplevel') | Select-Object -First 1).Trim()
    if (-not (Test-CanonicalPathEqual $gitRoot $repoExpected)) { throw 'GIT_ROOT_MISMATCH' }
    if ((Invoke-GitText @('remote', 'get-url', 'origin') | Select-Object -First 1).Trim() -cne $remoteExpected) { throw 'CANONICAL_ORIGIN_MISMATCH' }
    if ((Invoke-GitText @('remote', 'get-url', '--push', 'origin') | Select-Object -First 1).Trim() -cne $remoteExpected) { throw 'CANONICAL_PUSH_ORIGIN_MISMATCH' }
    if ((Invoke-GitText @('branch', '--show-current') | Select-Object -First 1).Trim() -cne 'main') { throw 'CANONICAL_BRANCH_MISMATCH' }
    $head = (Invoke-GitText @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
    $baseline = Get-WorktreeSnapshot

    if (-not (Test-Path -LiteralPath (Join-Path $serverRoot '.env') -PathType Leaf)) { throw 'SERVER_ENV_FILE_MISSING' }
    $datasetPath = Join-Path $serverRoot 'agents\evals\plan-review-v1.json'
    $datasetHash = (Get-FileHash -LiteralPath $datasetPath -Algorithm SHA256).Hash
    if ($datasetHash -cne $datasetHashExpected) { throw 'PHASE16_DATASET_CHECKSUM_MISMATCH' }

    $requiredMarkers = @(
        @{ Path = 'services\providerAbstraction.js'; Pattern = 'qwen/qwen3\.8-27b' },
        @{ Path = 'agents\evals\isolatedPlanReviewRunner.js'; Pattern = 'planReviewRole' },
        @{ Path = 'services\groundedExplanationCompleteness.js'; Pattern = 'CLAIM_EVIDENCE_RELEVANCE_INSUFFICIENT' },
        @{ Path = 'services\groundedExplanationCompleteness.js'; Pattern = 'UNAUTHORIZED_FINANCIAL_DIRECTIVE' },
        @{ Path = 'services\groundedExplanationService.js'; Pattern = 'grounded-financial-explanation-prompt-1\.3\.1' }
    )
    foreach ($marker in $requiredMarkers) {
        $sourcePath = Join-Path $serverRoot $marker.Path
        if (-not (Select-String -LiteralPath $sourcePath -Pattern $marker.Pattern -Quiet)) { throw 'PHASE16_IMPLEMENTATION_MARKER_MISSING' }
    }

    $changedPaths = @(
        (Invoke-GitText @('diff', 'HEAD', '--name-only'))
        (Invoke-GitText @('ls-files', '--others', '--exclude-standard'))
    ) | Sort-Object -Unique
    $secretPattern = '(?i)(?:gsk_[A-Za-z0-9]{20,}|AIzaSy[A-Za-z0-9_-]{20,}|nvapi-[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|Bearer\s+[A-Za-z0-9._-]{30,})'
    foreach ($relativePath in $changedPaths) {
        if ($relativePath -match '(^|[\\/])\.env$') { continue }
        $sourcePath = Join-Path $repoRoot $relativePath
        if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
            $content = [System.IO.File]::ReadAllText($sourcePath)
            if ([System.Text.RegularExpressions.Regex]::IsMatch($content, $secretPattern)) { throw 'SECRET_PATTERN_MATCH_IN_CHANGED_SOURCE' }
        }
    }

    $offlineTestPaths = @(
        'test/phase16Certification.test.js',
        'test/chatResponseDtoIsolation.test.js',
        'test/chatRoutes.test.js',
        'test/geminiChatService.test.js',
        'test/planReviewGroqModelRouting.test.js',
        'test/providerOutputContracts.test.js',
        'test/groqProviderIntegration.test.js',
        'test/phase6GroundedNim.test.js',
        'test/typedFinancialClaims.test.js',
        'test/planReviewTokenBudget.test.js',
        'test/planReviewLiveEvalCommand.test.js',
        'test/isolatedPlanReviewRunner.test.js',
        'test/providerResilience.test.js',
        'test/replanLoop.test.js',
        'test/reliabilityLab.test.js',
        'test/serviceCoverage.test.js',
        'test/sessionCostSafety.test.js',
        'test/twoPassChatLoop.test.js',
        'test/financialStateIntegrity.test.js',
        'test/financialStateAdversarial.test.js',
        'test/financialProfileArchitectureFreeze.test.js',
        'test/recommendationGenerationImmutable.test.js',
        'test/recommendationFreshness.test.js',
        'test/planReviewAgent.test.js',
        'test/planReviewPersistence.test.js',
        'test/taxAuthorityProvenance.test.js',
        'test/immutableIdentity.test.js',
        'test/authorizationFabric.test.js',
        'test/buildProvenance.test.js'
    )
    foreach ($testPath in $offlineTestPaths) {
        if (-not (Test-Path -LiteralPath (Join-Path $serverRoot $testPath) -PathType Leaf)) { throw 'OFFLINE_TEST_PATH_MISSING' }
    }

    $phase = 'OFFLINE_TESTS'
    # Dotenv is used by some test modules. Explicit empty credentials prevent
    # that loader from exposing .env keys to the offline test child process.
    $env:GROQ_API_KEY = ''
    $env:GEMINI_API_KEY = ''
    $env:NVIDIA_API_KEY = ''
    $env:LLM_DEFAULT_PROVIDER = ''
    $env:LLM_GEMINI_FALLBACK_ENABLED = 'false'
    $env:RUN_AGENT_LIVE_EVALS = 'false'
    Push-Location -LiteralPath $serverRoot
    try {
        $offlineTestOutput = @(& node --test --test-concurrency=1 --test-reporter=tap @offlineTestPaths 2>&1)
        $offlineTestExitCode = $LASTEXITCODE
    } finally { Pop-Location }
    $offlineTestSummary = [string]::Join("`n", @($offlineTestOutput | ForEach-Object { [string]$_ }))
    $tapSummary = ConvertFrom-NodeTapSummary $offlineTestSummary
    $offlineTestDiagnostics = [PSCustomObject]@{
        tests = $tapSummary.Tests
        passed = $tapSummary.Passed
        failed = $tapSummary.Failed
        cancelled = $tapSummary.Cancelled
        skipped = $tapSummary.Skipped
        processExitCode = $offlineTestExitCode
    }
    if (-not $tapSummary.Valid) { throw $tapSummary.Code }
    if ($offlineTestExitCode -ne 0) { throw 'OFFLINE_TESTS_FAILED' }
    $offlineTestCount = $tapSummary.Tests
    $offlinePassedCount = $tapSummary.Passed
    $offlineFailedCount = $tapSummary.Failed
    $offlineSkippedCount = $tapSummary.Skipped

    $phase = 'LINT_AND_TYPECHECK'
    & npm run lint --prefix $serverRoot *> $null
    if ($LASTEXITCODE -ne 0) { throw 'SERVER_LINT_FAILED' }
    & npm run typecheck --prefix $serverRoot *> $null
    if ($LASTEXITCODE -ne 0) { throw 'SERVER_TYPECHECK_FAILED' }

    $phase = 'CHANGED_JAVASCRIPT_SYNTAX'
    $javascriptPaths = @($changedPaths | Where-Object { $_ -match '\.js$' })
    foreach ($relativePath in $javascriptPaths) {
        $sourcePath = Join-Path $repoRoot $relativePath
        if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
            & node --check $sourcePath *> $null
            if ($LASTEXITCODE -ne 0) { throw 'CHANGED_JAVASCRIPT_SYNTAX_FAILED' }
        }
    }

    $afterOffline = Get-WorktreeSnapshot
    if ($baseline.Status -cne $afterOffline.Status) { throw 'OFFLINE_PREFLIGHT_CHANGED_WORKTREE' }
    if ($baseline.Stashes -cne $afterOffline.Stashes) { throw 'OFFLINE_PREFLIGHT_CHANGED_STASHES' }

    $phase = 'BOUNDED_LIVE_CERTIFICATION'
    foreach ($name in @('GROQ_API_KEY', 'GEMINI_API_KEY', 'NVIDIA_API_KEY', 'LLM_DEFAULT_PROVIDER')) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $env:LLM_PRIMARY_PROVIDER = 'GROQ'
    $env:GROQ_MODEL = 'openai/gpt-oss-120b'
    $env:LLM_GEMINI_FALLBACK_ENABLED = 'false'
    $env:RUN_AGENT_LIVE_EVALS = 'true'
    Push-Location -LiteralPath $serverRoot
    try {
        $nodeOutput = @(& node scripts/phase16Certification.js 2>$null)
        $nodeExitCode = $LASTEXITCODE
    } finally { Pop-Location }
    $nodeJson = [string]::Join("`n", $nodeOutput)
    if (-not $nodeJson.Trim()) { throw 'CERTIFICATION_RUNNER_NO_REPORT' }
    try { $report = $nodeJson | ConvertFrom-Json } catch { throw 'CERTIFICATION_RUNNER_REPORT_INVALID' }
    $resultExitCode = if ($nodeExitCode -eq 0) { 0 } else { 1 }
    $phase = 'POST_RUN_REPOSITORY_VERIFICATION'
    $afterRun = Get-WorktreeSnapshot
    if ($baseline.Status -cne $afterRun.Status) { throw 'CERTIFICATION_RUN_CHANGED_WORKTREE' }
    if ($baseline.Stashes -cne $afterRun.Stashes) { throw 'CERTIFICATION_RUN_CHANGED_STASHES' }
    if ((Invoke-GitText @('rev-parse', 'HEAD') | Select-Object -First 1).Trim() -cne $head) { throw 'CERTIFICATION_RUN_CHANGED_HEAD' }

    $report | Add-Member -NotePropertyName offlinePreflight -NotePropertyValue ([PSCustomObject]@{
        passed = $true
        testSuites = $offlineTestPaths.Count
        tests = $offlineTestCount
        passedTests = $offlinePassedCount
        failedTests = $offlineFailedCount
        cancelledTests = $tapSummary.Cancelled
        skippedTests = $offlineSkippedCount
        lint = 'PASS'
        typecheck = 'PASS'
        changedJavaScriptSyntax = 'PASS'
        secretPatternScan = 'PASS'
        datasetSha256 = $datasetHash
        mongoRequiredSuitesSkipped = @('test/recommendPostCommitCurrentState.test.js', 'test/recommendRestore.test.js', 'test/recommendationAllocationRevisionBehavior.test.js', 'test/planReviewMandateMongo.integration.test.js')
        skipReason = 'Transaction-capable Mongo integration is outside this isolated provider certification runner.'
    }) -Force
    $report | Add-Member -NotePropertyName git -NotePropertyValue ([PSCustomObject]@{
        repository = $repoExpected
        originVerified = $true
        branch = 'main'
        head = $head
        dirtyPathCountPreserved = $baseline.DirtyPathCount
        worktreeUnchanged = $true
        stashesUnchanged = $true
    }) -Force
} catch {
    $resultExitCode = 1
    $report = [PSCustomObject]@{
        verdict = 'PHASE16_BLOCKED'
        phase = $phase
        code = if ($_.Exception.Message -match '^[A-Z0-9_:-]{2,100}$') { $_.Exception.Message } else { $failureCode }
    }
    if ($null -ne $offlineTestDiagnostics) {
        $report | Add-Member -NotePropertyName offlineTestDiagnostics -NotePropertyValue $offlineTestDiagnostics
    }
} finally {
    foreach ($name in $envNames) {
        $value = $savedEnvironment[$name]
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

if ($null -eq $report) {
    $report = [PSCustomObject]@{ verdict = 'PHASE16_BLOCKED'; phase = $phase; code = 'CERTIFICATION_REPORT_MISSING' }
    $resultExitCode = 1
}
ConvertTo-Json -InputObject $report -Depth 12 -Compress
exit $resultExitCode

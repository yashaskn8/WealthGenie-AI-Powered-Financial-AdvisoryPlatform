const BUILD_SHA_PATTERN = /^[a-f\d]{40}$/i;

export function normalizeBuildSha(value) {
  return typeof value === 'string' && BUILD_SHA_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

export function matchesBuildSha(expected, reported) {
  const expectedSha = normalizeBuildSha(expected);
  const reportedSha = normalizeBuildSha(reported);
  return Boolean(expectedSha && reportedSha && expectedSha === reportedSha);
}

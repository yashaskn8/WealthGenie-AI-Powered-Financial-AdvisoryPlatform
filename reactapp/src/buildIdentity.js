import { normalizeBuildSha } from '../../shared/buildIdentity.js';

export const frontendBuildSha = normalizeBuildSha(import.meta.env.VITE_BUILD_SHA) || '';

if (typeof document !== 'undefined') {
  document.documentElement.dataset.buildSha = frontendBuildSha;
}

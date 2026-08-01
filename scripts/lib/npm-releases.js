// npm-releases.js — what @imqueue/<pkg> has actually published, and the semver
// comparison the publish policy in build-api-docs.js is built on.
//
// Extracted from build-api-docs.js so scripts/check-api-versions.js can ask "which
// version SHOULD /api/<pkg>/latest/ be advertising?" and get the same answer the
// generator would produce. A second implementation of "latest" is the one thing
// that would make the staleness check useless: compute it differently and the check
// either nags about a package that is fine or stays quiet about one that is not.
//
// Note this is deliberately NOT `npm view <pkg> version`, which reports the `latest`
// dist-tag. The policy is "the highest published release", so a mistagged or
// deliberately-held dist-tag does not decide what the reference documents.
const { execSync } = require('child_process');

// Release versions only. parseVer('4.0.0-rc.1') yields [4, 0, NaN], which sorts
// unpredictably rather than failing, so pre-releases are filtered out before any
// comparison happens — never sorted and then discarded.
function parseVer(v) { return v.split('.').map(Number); }
function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}
function majorOf(v) { return parseVer(v)[0]; }

// Every published release of a package, oldest first. Throws if npm is unreachable
// or the package does not exist — callers must not treat a network failure as "no
// versions", which would read as "nothing to do".
function releaseVersions(pkg) {
  // A package with exactly one version answers with a bare string, not an array.
  const raw = JSON.parse(execSync(
    `npm view @imqueue/${pkg} versions --json`,
    { stdio: ['ignore', 'pipe', 'ignore'] },
  ).toString());

  return (Array.isArray(raw) ? raw : [raw])
    .filter(v => !v.includes('-')) // drop pre-releases
    .sort(cmpVer);
}

// The version /api/<pkg>/latest/ is supposed to be documenting.
function latestRelease(pkg) {
  const versions = releaseVersions(pkg);
  return versions[versions.length - 1];
}

module.exports = { parseVer, cmpVer, majorOf, releaseVersions, latestRelease };

// npm-releases.ts — what @imqueue/<pkg> has actually published, and the semver
// comparison the publish policy in build-api-docs.ts is built on.
//
// Extracted from build-api-docs.ts so scripts/check-api-versions.ts can ask "which
// version SHOULD /api/<pkg>/latest/ be advertising?" and get the same answer the
// generator would produce. A second implementation of "latest" is the one thing
// that would make the staleness check useless: compute it differently and the check
// either nags about a package that is fine or stays quiet about one that is not.
//
// Note this is deliberately NOT `npm view <pkg> version`, which reports the `latest`
// dist-tag. The policy is "the highest published release", so a mistagged or
// deliberately-held dist-tag does not decide what the reference documents.
import { execSync } from 'node:child_process';

// Release versions only. parseVer('4.0.0-rc.1') yields [4, 0, NaN], which sorts
// unpredictably rather than failing, so pre-releases are filtered out before any
// comparison happens — never sorted and then discarded.
export function parseVer(v: string): number[] { return v.split('.').map(Number); }
export function cmpVer(a: string, b: string): number {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}
export function majorOf(v: string): number { return parseVer(v)[0] ?? NaN; }

// Every published release of a package, oldest first. Throws if npm is unreachable
// or the package does not exist — callers must not treat a network failure as "no
// versions", which would read as "nothing to do".
export function releaseVersions(pkg: string): string[] {
  // A package with exactly one version answers with a bare string, not an array.
  const raw: unknown = JSON.parse(execSync(
    `npm view @imqueue/${pkg} versions --json`,
    { stdio: ['ignore', 'pipe', 'ignore'] },
  ).toString());

  return (Array.isArray(raw) ? raw as string[] : [raw as string])
    .filter(v => !v.includes('-')) // drop pre-releases
    .sort(cmpVer);
}

// The version /api/<pkg>/latest/ is supposed to be documenting.
export function latestRelease(pkg: string): string | undefined {
  const versions = releaseVersions(pkg);
  return versions[versions.length - 1];
}

// One published version's manifest, as npm has it.
//
// The REGISTRY, not the working copy. `core/package.json` on this machine said
// 3.3.2 while npm served 3.4.0 — a local checkout is whatever was last pulled, and
// /status/ exists precisely because an agent cannot read npm for itself. Reading a
// sibling directory would publish a claim about what is installed here.
//
// Pinned to an explicit version rather than asking for the package: `npm view <pkg>
// --json` reports the `latest` DIST-TAG, and the policy everywhere in this repo is
// the highest published release (see releaseVersions above). Passing the version
// keeps the two answers from ever being different things.
export function packageManifest(pkg: string, version: string): Record<string, unknown> {
  return JSON.parse(execSync(
    `npm view @imqueue/${pkg}@${version} --json`,
    { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 },
  ).toString());
}

// When each version of a package was published, as { version: ISO-8601 }.
//
// The same call build-api-docs.ts:158 makes for sitemap lastmod. Extracted so the
// status feed and the sitemap date a release from one source; two implementations
// of "when did this ship" is exactly the drift /status/ is meant to end.
//
// The object also carries `created` and `modified` keys, which are NOT versions.
// Callers index by a version string, so they never see them.
export function releaseTimes(pkg: string): Record<string, string> {
  return JSON.parse(execSync(
    `npm view @imqueue/${pkg} time --json`,
    { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 },
  ).toString());
}

// Playwright configuration for the imqueue.org end-to-end suite.
//
//   npm run test:e2e            # the whole suite
//   npm run test:e2e -- --grep search
//   npm run test:e2e:report     # last run's HTML report
//
// The suite drives the BUILT site (`npm run build:all`) through
// tests/e2e/server/pages-server.ts, which runs the real Cloudflare Pages
// Functions in front of it. Nothing here builds: a watcher rebuilding mid-run is
// how a green suite starts describing a site that no longer exists.

import { defineConfig, devices } from '@playwright/test';

// Off the dev-server ports (8080/8081) on purpose, so a `npm run serve:org` left
// running in another terminal is neither used by accident nor killed.
const PORT = Number(process.env.E2E_PORT || 8099);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// One worker is one Chromium. Two by default — deliberately below the four this
// machine allows, because a run that is INTERRUPTED leaves its browsers behind and
// the next run adds its own on top. `npm run test:e2e` reaps strays before it
// starts (see the `pretest:e2e` script) and E2E_WORKERS raises the ceiling for a
// run somebody is watching.
const WORKERS = Number(process.env.E2E_WORKERS || 2);

// THE DISCRETE GPU IS NOT ALLOWED NEAR THIS SUITE.
//
// Full Chromium enumerates GPUs at startup even when it is headless and renders
// nothing on them. On this machine that enumeration resumes a runtime-suspended
// NVIDIA card, and the resume path wedges the workstation — three hard freezes,
// each ending on `nvidia 0000:02:00.0: Enabling HDA controller` with no OOM kill
// and no panic. tests/e2e/support/gpu.ts has the full reasoning and does the work
// of making the discrete card unfindable; this file decides which mode to ask for.
//
// HEADLESS (the default) — `chromium-headless-shell`, the binary with no
// window-system or GPU integration to initialise at all, plus software rendering
// and --disable-gpu. It touches no GPU of any kind.
//
// HEADED (`--headed`, or E2E_HEADED=1) — full Chromium, because a headed run is
// for WATCHING the browser and the headless shell has no window. Here the browser
// does render on a GPU, so it is pinned to the INTEGRATED one: Mesa is given the
// integrated card by PCI address, glvnd is given Mesa's EGL vendor only and the
// Vulkan loader the integrated card's ICD only, so the discrete card is never
// dlopened, never enumerated and never woken. Software rendering is deliberately
// NOT forced here — pinning to the iGPU is the point, llvmpipe would defeat it.
import { gpuEnv, describe as describeGpu } from './support/gpu';

const HEADED = process.env.E2E_HEADED === '1' || process.argv.includes('--headed');

const CHANNEL = process.env.E2E_CHANNEL || (HEADED ? 'chromium' : 'chromium-headless-shell');

const LAUNCH = {
  args: [
    // Only in headless: a headed run must be allowed to reach the integrated GPU,
    // which is what the environment below has pinned it to.
    ...(HEADED ? [] : ['--disable-gpu', '--disable-software-rasterizer']),
    '--disable-gpu-compositing',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--renderer-process-limit=2',
  ],
  env: {
    ...process.env,
    ...gpuEnv({ software: !HEADED }),
  },
};

console.log(`e2e: ${HEADED ? 'headed' : 'headless'} (${CHANNEL}) — ${describeGpu()}`);

export default defineConfig({
  testDir: './specs',
  outputDir: './.artifacts',
  fullyParallel: true,
  workers: WORKERS,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  // A broken build should stop the run, not launch a browser per page to prove it
  // is broken the same way 40 more times.
  maxFailures: process.env.CI ? 0 : 10,
  expect: { timeout: 10_000 },
  // A single line reporter: the HTML one writes a copy of every attachment and
  // then a report process on top of the browsers.
  reporter: [['line']],
  use: {
    baseURL: BASE_URL,
    // Tracing screenshots every action of every test, and keeps it all in memory
    // until the test ends. Off by default; `--trace on` when actually debugging.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    // The suite asserts on what the page requests, and a redirect-following
    // fetch of an external tag would leave this machine. Every external host is
    // stubbed in tests/e2e/support/fixtures.ts; this is the second lock.
    bypassCSP: false,
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /\.mobile\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        channel: CHANNEL,
        launchOptions: LAUNCH,
      },
    },
    {
      // The nav bar hides its own links below 900px and the drawer carries the
      // only search entry point there — a real device profile, not a resized
      // desktop, because `isMobile` is what the drawer's media queries answer to.
      name: 'mobile',
      testMatch: /\.mobile\.spec\.ts$/,
      use: { ...devices['Pixel 7'], channel: CHANNEL, launchOptions: LAUNCH },
    },
  ],
  webServer: {
    command: `node ${import.meta.dirname}/server/pages-server.ts --port ${PORT}`,
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // The server imports the Pages Functions, which are ESM inside a CommonJS
    // package; Node says so on every start and it is not news.
    env: { NODE_NO_WARNINGS: '1' },
  },
});

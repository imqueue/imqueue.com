#!/usr/bin/env node
// which-gpu.js — prove which GPU the test browser actually used.
//
//   node tests/e2e/support/which-gpu.js            # headless (the suite's default)
//   node tests/e2e/support/which-gpu.js --headed   # headed, pinned to the iGPU
//
// The configuration in playwright.config.js CLAIMS the browser renders on the
// integrated card and never touches the discrete one. This checks the claim, in
// the only two ways that are not self-reported:
//
//   1. The discrete GPU's runtime power state, read from sysfs before and after.
//      It sits in `suspended`; anything that enumerates it wakes it to `active`.
//      Staying suspended across a browser launch is the assertion that matters —
//      it is the wake, not the rendering, that hangs this machine.
//   2. WebGL's UNMASKED_RENDERER_STRING, which is the driver naming itself. On a
//      correct headed run it says Intel (or llvmpipe under software rendering),
//      and must never say NVIDIA.
//
// Exits non-zero if the discrete card woke or the renderer is an NVIDIA one, so
// it can be run as a check rather than read as a report.

'use strict';

const { chromium } = require('@playwright/test');
const { gpuEnv, discreteStatus, describe } = require('./gpu');

const HEADED = process.argv.includes('--headed');

const snapshot = () =>
  discreteStatus().map((card) => `${card.driver}@${card.slot}=${card.status}`);

async function main() {
  console.log(`mode:    ${HEADED ? 'headed (full chromium)' : 'headless (chromium-headless-shell)'}`);
  console.log(`config:  ${describe()}`);

  const before = snapshot();

  console.log(`before:  ${before.join(' ') || '(no discrete card)'}`);

  const browser = await chromium.launch({
    channel: HEADED ? 'chromium' : 'chromium-headless-shell',
    headless: !HEADED,
    args: [
      ...(HEADED ? [] : ['--disable-gpu', '--disable-software-rasterizer']),
      '--disable-gpu-compositing',
      '--disable-dev-shm-usage',
    ],
    env: { ...process.env, ...gpuEnv({ software: !HEADED }) },
  });

  const page = await browser.newPage();

  // A real GL context, because that is what makes the driver commit to a device.
  // `null` when the browser refuses one at all, which is the expected — and
  // safest — answer in the headless default.
  const renderer = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    if (!gl) {
      return null;
    }

    const info = gl.getExtension('WEBGL_debug_renderer_info');

    return {
      unmasked: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
      plain: gl.getParameter(gl.RENDERER),
    };
  });

  const during = snapshot();

  await browser.close();

  const after = snapshot();

  console.log(`during:  ${during.join(' ') || '(no discrete card)'}`);
  console.log(`after:   ${after.join(' ') || '(no discrete card)'}`);
  console.log(`webgl:   ${renderer ? `${renderer.unmasked || renderer.plain} (${renderer.vendor || 'vendor unknown'})` : 'no GL context (nothing rendered on any GPU)'}`);

  const woke = during.some((line) => line.endsWith('=active'));
  const nvidia = renderer && /nvidia|geforce|rtx/i.test(
    `${renderer.unmasked || ''} ${renderer.vendor || ''} ${renderer.plain || ''}`,
  );

  if (woke) {
    console.error('\nFAIL: the discrete GPU woke during the browser launch.');
  }

  if (nvidia) {
    console.error('\nFAIL: WebGL is rendering on the discrete GPU.');
  }

  if (!woke && !nvidia) {
    console.log('\nOK: the discrete GPU stayed suspended and nothing rendered on it.');
  }

  process.exit(woke || nvidia ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

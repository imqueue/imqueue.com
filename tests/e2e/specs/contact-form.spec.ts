// contact-form.spec.ts — /contact/, the only form on imqueue.org and the only
// place a reader can put data into the site.
//
// Everything here runs in the browser: the form validates, reads attachments and
// POSTs JSON to /api/message, which is a Cloudflare Pages Function. That endpoint
// is NOT under test — it is route-mocked, so these tests cover the half that
// ships in the page, and cover it without sending anybody mail.
//
// Attachments are built in memory rather than written to disk: what the code
// cares about is the name, the size and the type of a File, and a Buffer supplies
// all three.

import type { Page } from '@playwright/test';

import { test, expect } from '../support/fixtures';

/** What the contact endpoint receives — the parts this spec reads back. */
interface PostedMessage {
  page: string;
  attachments: { filename: string; data: string }[];
}

const ENDPOINT = '**/api/message';

// Several tests below stub this endpoint with a refusal, which is the behaviour
// under test — so its non-OK responses must not be counted as the page having
// broken. See `allowFailedRequests` in support/fixtures.ts.
test.use({ allowFailedRequests: [/\/api\/message$/] });

const FILLED = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  subject: 'A question about @imqueue',
  message: 'How does the retry policy interact with delayed jobs?',
};

async function fill(page: Page, values: Record<string, string> = FILLED) {
  for (const [field, value] of Object.entries(values)) {
    await page.locator(`.cf-form [name="${field}"]`).fill(value);
  }
}

/** An in-memory attachment of an exact size, so the limits can be pushed at. */
const attachment = (name: string, bytes: number, mimeType = 'text/plain') => ({
  name,
  mimeType,
  buffer: Buffer.alloc(bytes, 0x61),
});

const error = (page: Page) => page.locator('[data-form-error]');

test.beforeEach(async ({ page }) => {
  await page.goto('/contact/');
});

test.describe('validation, before anything is sent', () => {
  // Each of these must also send NOTHING: a form that reports an error and posts
  // anyway is the failure mode worth testing for.
  test.beforeEach(async ({ page }) => {
    await page.route(ENDPOINT, (route) => route.abort());
  });

  test('an empty form asks for the name first', async ({ page }) => {
    await page.locator('.cf-submit').click();

    await expect(error(page)).toBeVisible();
    await expect(error(page)).toHaveText(/enter your name/i);
  });

  test('an address that is not an address is refused', async ({ page }) => {
    await fill(page, { ...FILLED, email: 'jane@example' });
    await page.locator('.cf-submit').click();

    await expect(error(page)).toHaveText(/valid email address/i);
  });

  test('a message with no subject is refused', async ({ page }) => {
    await fill(page, { ...FILLED, subject: '   ' });
    await page.locator('.cf-submit').click();

    await expect(error(page)).toHaveText(/subject/i);
  });

  test('an empty message is refused', async ({ page }) => {
    await fill(page, { ...FILLED, message: '' });
    await page.locator('.cf-submit').click();

    await expect(error(page)).toHaveText(/write a message/i);
  });

  test('the form is still there to correct — nothing is lost', async ({ page }) => {
    await fill(page, { ...FILLED, email: 'nope' });
    await page.locator('.cf-submit').click();

    await expect(page.locator('[data-contact-form]')).toBeVisible();
    await expect(page.locator('[name="message"]')).toHaveValue(FILLED.message);
  });
});

test.describe('attachments', () => {
  test('what is attached is listed, with its size', async ({ page }) => {
    await page.locator('#cf-files').setInputFiles([
      attachment('screenshot.png', 2048, 'image/png'),
      attachment('server.log', 4096),
    ]);

    const list = page.locator('[data-cf-files]');

    await expect(list).toBeVisible();
    await expect(list.locator('li')).toHaveCount(2);
    await expect(list).toContainText('screenshot.png');
    // Sizes are shown so that "too large" is visible BEFORE a long message is
    // written and lost to it.
    await expect(list.locator('.cf-size').first()).toHaveText('2 KB');
  });

  test('a file type the endpoint will not take is refused by name', async ({ page }) => {
    await fill(page);
    await page.locator('#cf-files').setInputFiles([
      attachment('payload.exe', 512, 'application/octet-stream'),
    ]);
    await page.locator('.cf-submit').click();

    await expect(error(page)).toContainText('payload.exe');
    await expect(error(page)).toContainText(/not an accepted file type/i);
  });

  test('a fourth file is refused as soon as it is chosen', async ({ page }) => {
    await page.locator('#cf-files').setInputFiles([
      attachment('one.txt', 16),
      attachment('two.txt', 16),
      attachment('three.txt', 16),
      attachment('four.txt', 16),
    ]);

    // On `change`, not on submit — the point is to say so before the message is
    // written.
    await expect(error(page)).toHaveText(/no more than 3 files/i);
  });

  test('more than 5 MB in total is refused, and says how much it came to', async ({ page }) => {
    await page.locator('#cf-files').setInputFiles([
      attachment('big.log', 3 * 1024 * 1024),
      attachment('bigger.log', 3 * 1024 * 1024),
    ]);

    await expect(error(page)).toHaveText(/6\.0 MB/);
    await expect(error(page)).toContainText('5 MB in total');
  });
});

test.describe('sending', () => {
  test('a complete message is posted as JSON and thanked for', async ({ page }) => {
    let posted: PostedMessage | null = null;

    await page.route(ENDPOINT, async (route) => {
      posted = route.request().postDataJSON() as PostedMessage;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await fill(page);
    await page.locator('#cf-files').setInputFiles([attachment('trace.log', 64)]);
    await page.locator('.cf-submit').click();

    await expect(page.locator('[data-thanks]')).toBeVisible();
    await expect(page.locator('[data-contact-form]')).toBeHidden();

    // Not `expect(posted).not.toBeNull()`: that fails the test but tells the
    // compiler nothing, and every read below would still need a `?.` — which
    // would turn "the endpoint was never called" into four assertions comparing
    // `undefined` to the values they wanted.
    if (posted === null) {
      throw new Error('the endpoint was never called');
    }

    const message: PostedMessage = posted;
    const [attached] = message.attachments;

    expect(message).toMatchObject(FILLED);
    // Which page it was sent from, so a documentation problem arrives with the
    // document attached to it.
    expect(message.page).toContain('/contact/');
    // Bare base64, no `data:` prefix — the endpoint rejects the prefixed form.
    expect(message.attachments).toHaveLength(1);
    expect(attached?.filename).toBe('trace.log');
    expect(attached?.data).not.toContain('base64,');
  });

  test('the button says what it is doing and cannot be pressed twice', async ({ page }) => {
    // Typed as the resolver rather than left to inference: `let release;` is
    // `undefined` to the checker, because the executor that assigns it runs
    // synchronously in a way TypeScript does not model — which is also why the
    // `release()` below could not be called without this.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    await page.route(ENDPOINT, async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await fill(page);
    await page.locator('.cf-submit').click();

    await expect(page.locator('.cf-submit')).toBeDisabled();
    await expect(page.locator('.cf-submit')).toHaveText(/Sending/);

    release();
    await expect(page.locator('[data-thanks]')).toBeVisible();
  });

  test('the endpoint’s own refusal is what the reader is shown', async ({ page }) => {
    await page.route(ENDPOINT, (route) =>
      route.fulfill({
        status: 413,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'That attachment is too large.' }),
      }),
    );

    await fill(page);
    await page.locator('.cf-submit').click();

    // The specific message, not a generic one: it is the useful half.
    await expect(error(page)).toHaveText('That attachment is too large.');
    await expect(page.locator('[data-thanks]')).toBeHidden();
    // And the form comes back, so the message can be retried rather than retyped.
    await expect(page.locator('.cf-submit')).toBeEnabled();
    await expect(page.locator('[name="message"]')).toHaveValue(FILLED.message);
  });

  test('a failure with nothing to say falls back to the address', async ({ page }) => {
    await page.route(ENDPOINT, (route) => route.fulfill({ status: 500, body: 'nope' }));

    await fill(page);
    await page.locator('.cf-submit').click();

    await expect(error(page)).toContainText('support@imqueue.com');
  });

  test('“send another” gives back an empty form, focused', async ({ page }) => {
    await page.route(ENDPOINT, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }),
    );

    await fill(page);
    await page.locator('.cf-submit').click();
    await expect(page.locator('[data-thanks]')).toBeVisible();

    await page.locator('[data-send-another]').click();

    await expect(page.locator('[data-contact-form]')).toBeVisible();
    await expect(page.locator('[name="message"]')).toHaveValue('');
    await expect(page.locator('[name="name"]')).toBeFocused();
  });
});

test.describe('the honeypot', () => {
  test('is invisible to a reader', async ({ page }) => {
    const hp = page.locator('input[name="company_url"]');

    await expect(hp).toBeAttached();

    // Positioned off-canvas rather than `display: none`, on purpose: a bot that
    // skips hidden fields would skip this one too, and then the trap catches
    // nothing. So the assertion is that it is off the screen, not that the
    // browser considers it hidden.
    await expect(hp).not.toBeInViewport();

    const box = await hp.boundingBox();

    expect(box, 'the honeypot has a box to be positioned off-screen').not.toBeNull();
    expect(box?.x).toBeLessThan(0);
    // Out of the tab order and out of the accessibility tree: a keyboard user
    // must not be able to land in it by accident and be treated as a bot.
    await expect(hp).toHaveAttribute('tabindex', '-1');
    await expect(hp).toHaveAttribute('aria-hidden', 'true');
  });

  test('a filled one is thanked and sends nothing', async ({ page }) => {
    let called = false;

    await page.route(ENDPOINT, (route) => {
      called = true;

      return route.abort();
    });

    await fill(page);
    await page.locator('input[name="company_url"]').fill('https://example.com', { force: true });
    await page.locator('.cf-submit').click();

    // Thanked, so a bot has nothing to learn from the response, and no request.
    await expect(page.locator('[data-thanks]')).toBeVisible();
    expect(called).toBe(false);
  });
});

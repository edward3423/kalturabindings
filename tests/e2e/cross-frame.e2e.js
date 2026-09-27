/**
 * Cross-frame E2E test: shortcuts pressed on a host page without media are
 * forwarded to a cross-origin iframe that controls the video (Kaltura shape).
 * Two local HTTP servers on different ports provide distinct origins.
 */

import http from 'http';
import { readFile } from 'fs/promises';
import { dirname, join, extname } from 'path';
import { fileURLToPath } from 'url';
import { launchChromeWithExtension, assert, sleep } from './e2e-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html',
  '.wav': 'audio/wav',
};

function serve(dir) {
  const server = http.createServer(async (req, res) => {
    const file = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    try {
      const body = await readFile(file);
      const type = MIME[extname(file)] || 'application/octet-stream';
      // Chrome only seeks media served with byte-range support.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, {
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${body.length}`,
          'Content-Length': end - start + 1,
        });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': body.length,
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

export default async function runCrossFrameE2ETests() {
  console.log('🎭 Running Cross-Frame E2E Tests...\n');

  let browser;
  let passed = 0;
  let failed = 0;
  const outer = await serve(__dirname);
  const inner = await serve(__dirname);

  const runTest = async (testName, testFn) => {
    try {
      console.log(`   🧪 ${testName}`);
      await testFn();
      console.log(`   ✅ ${testName}`);
      passed++;
    } catch (error) {
      console.log(`   ❌ ${testName}: ${error.message}`);
      failed++;
    }
  };

  const getFrame = (page) => page.frames().find((f) => f.url().includes('cross-frame-inner'));
  const videoState = (frame) =>
    frame.evaluate(() => {
      const v = document.querySelector('video');
      return { rate: v.playbackRate, time: v.currentTime, paused: v.paused, ready: v.readyState };
    });

  try {
    const { browser: chromeBrowser, page } = await launchChromeWithExtension();
    browser = chromeBrowser;

    await runTest('Host page loads with cross-origin player iframe', async () => {
      // localhost vs 127.0.0.1 with different ports: distinct origins.
      await page.goto(`http://localhost:${outer.port}/cross-frame.html`, {
        waitUntil: 'domcontentloaded',
      });
      await page.evaluate((src) => {
        document.getElementById('player').src = src;
      }, `http://127.0.0.1:${inner.port}/cross-frame-inner.html`);
      await sleep(3000);
      const frame = getFrame(page);
      assert.true(!!frame, 'inner frame should exist');
      await frame.waitForFunction(() => document.querySelector('video')?.readyState >= 2, {
        timeout: 10000,
      });
      await frame.waitForSelector('vsc-controller', { timeout: 10000 });
    });

    await runTest('W on the host page sets 2x inside the iframe', async () => {
      await page.focus('h1').catch(() => {});
      await page.evaluate(() => document.body.focus());
      await page.keyboard.press('KeyW');
      await sleep(500);
      const state = await videoState(getFrame(page));
      assert.equal(state.rate, 2, 'iframe video rate should be 2x');
    });

    await runTest('Q on the host page returns to 1x inside the iframe', async () => {
      await page.keyboard.press('KeyQ');
      await sleep(500);
      const state = await videoState(getFrame(page));
      assert.equal(state.rate, 1, 'iframe video rate should be 1x');
    });

    await runTest('R sets 4x (custom row wins over predefined reset)', async () => {
      await page.keyboard.press('KeyR');
      await sleep(500);
      const state = await videoState(getFrame(page));
      assert.equal(state.rate, 4, 'iframe video rate should be 4x');
    });

    await runTest('L and J seek forward and back (clamped to the 2s fixture)', async () => {
      const frame = getFrame(page);
      // The fixture is 2 seconds long, so +10/-10 clamp to the ends. Disable
      // loop so a seek to the end does not wrap back to 0.
      await frame.evaluate(() => {
        const v = document.querySelector('video');
        v.loop = false;
        v.pause();
        v.currentTime = 1;
      });
      await sleep(300);
      await page.keyboard.press('KeyL');
      await sleep(500);
      let state = await videoState(frame);
      assert.true(state.time > 1, `time should advance past 1s, got ${state.time}`);
      await page.keyboard.press('KeyJ');
      await sleep(500);
      state = await videoState(frame);
      assert.equal(state.time, 0, 'time should rewind to 0');
    });

    await runTest('K toggles play/pause inside the iframe', async () => {
      const frame = getFrame(page);
      // Loop again so the short fixture does not end (and re-pause) before
      // the state is read back.
      await frame.evaluate(() => {
        const v = document.querySelector('video');
        v.loop = true;
        v.currentTime = 0;
      });
      await sleep(300);
      const before = (await videoState(frame)).paused;
      await page.keyboard.press('KeyK');
      await sleep(700);
      const after = (await videoState(frame)).paused;
      assert.true(before !== after, `paused should flip (before=${before}, after=${after})`);
    });

    await runTest('Shortcuts still work with focus inside the iframe', async () => {
      const frame = getFrame(page);
      await frame.evaluate(() => document.body.focus());
      await page.keyboard.press('KeyE');
      await sleep(500);
      const state = await videoState(frame);
      assert.equal(state.rate, 3, 'iframe video rate should be 3x');
    });
  } catch (error) {
    console.log(`   💥 Suite error: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
    outer.server.close();
    inner.server.close();
  }

  return { passed, failed };
}

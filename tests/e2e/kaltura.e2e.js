/**
 * Kaltura E2E test (network-dependent, opt-in: `node tests/e2e/run-e2e.js kaltura`).
 * Loads a public Kaltura V7 iframe embed and checks shortcuts both with the
 * player focused (Kaltura's own K handler must not undo ours) and with the
 * host page focused (forwarding into the cross-origin frame).
 */

import http from 'http';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { launchChromeWithExtension, assert, sleep } from './e2e-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function serve(dir) {
  const server = http.createServer(async (req, res) => {
    try {
      const body = await readFile(join(dir, new URL(req.url, 'http://x').pathname));
      res.writeHead(200, { 'Content-Type': 'text/html' });
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

export default async function runKalturaE2ETests() {
  console.log('🎭 Running Kaltura E2E Tests...\n');

  let browser;
  let passed = 0;
  let failed = 0;
  const host = await serve(__dirname);

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

  const getFrame = (page) => page.frames().find((f) => f.url().includes('cdnapisec.kaltura.com'));
  const videoState = (frame) =>
    frame.evaluate(() => {
      const v = document.querySelector('video');
      const a = document.activeElement;
      return {
        rate: v.playbackRate,
        time: v.currentTime,
        paused: v.paused,
        muted: v.muted,
        volume: v.volume,
        activeInsidePlayer: !!a && !!a.closest('.playkit-player'),
      };
    });

  try {
    const { browser: chromeBrowser, page } = await launchChromeWithExtension();
    browser = chromeBrowser;
    let playerBox;

    await runTest('Kaltura player loads inside the cross-origin iframe', async () => {
      await page.goto(`http://localhost:${host.port}/kaltura.html`, {
        waitUntil: 'domcontentloaded',
      });
      await sleep(6000);
      const frame = getFrame(page);
      assert.true(!!frame, 'Kaltura frame should exist');
      playerBox = await (await page.$('#player')).boundingBox();
      // Click the poster to start playback; this also focuses the player.
      await page.mouse.click(playerBox.x + playerBox.width / 2, playerBox.y + playerBox.height / 2);
      await frame.waitForSelector('vsc-controller', { timeout: 90000 });
      await frame.waitForFunction(() => document.querySelector('video').readyState >= 3, {
        timeout: 90000,
      });
      await sleep(1000);
      const state = await videoState(frame);
      assert.true(state.activeInsidePlayer, 'focus should be inside the player');
      assert.true(!state.paused, 'video should be playing');
    });

    await runTest('W sets 2x with the player focused', async () => {
      await page.keyboard.press('KeyW');
      await sleep(600);
      assert.equal((await videoState(getFrame(page))).rate, 2, 'rate should be 2x');
    });

    await runTest(
      'K pauses with the player focused (Kaltura K handler must not undo it)',
      async () => {
        await page.keyboard.press('KeyK');
        await sleep(800);
        assert.true((await videoState(getFrame(page))).paused, 'video should be paused');
      }
    );

    await runTest('K resumes with the player focused', async () => {
      await page.keyboard.press('KeyK');
      await sleep(800);
      assert.true(!(await videoState(getFrame(page))).paused, 'video should be playing');
    });

    await runTest('L advances about 10 seconds with the player focused', async () => {
      const before = (await videoState(getFrame(page))).time;
      await page.keyboard.press('KeyL');
      await sleep(600);
      const after = (await videoState(getFrame(page))).time;
      assert.true(after - before >= 9 && after - before <= 13, `advanced ${after - before}s`);
    });

    await runTest(
      'Holding Shift with the player focused runs 8x, release restores 2x',
      async () => {
        await page.keyboard.down('ShiftLeft');
        await sleep(600);
        assert.equal((await videoState(getFrame(page))).rate, 8, 'rate should be 8x while held');
        await page.keyboard.up('ShiftLeft');
        await sleep(600);
        assert.equal((await videoState(getFrame(page))).rate, 2, 'rate should return to 2x');
      }
    );

    await runTest(
      'M toggles mute with the player focused (custom row wins over marker)',
      async () => {
        const before = (await videoState(getFrame(page))).muted;
        await page.keyboard.press('KeyM');
        await sleep(600);
        const after = (await videoState(getFrame(page))).muted;
        assert.true(before !== after, `muted should flip (before=${before}, after=${after})`);
        await page.keyboard.press('KeyM');
        await sleep(600);
        assert.equal((await videoState(getFrame(page))).muted, before, 'muted should flip back');
      }
    );

    await runTest('Q returns to 1x with the host page focused (forwarded)', async () => {
      await page.evaluate(() => {
        document.querySelector('h1').setAttribute('tabindex', '-1');
        document.querySelector('h1').focus();
      });
      await sleep(300);
      await page.keyboard.press('KeyQ');
      await sleep(600);
      assert.equal((await videoState(getFrame(page))).rate, 1, 'rate should be 1x');
    });

    await runTest('R sets 4x with the host page focused (forwarded)', async () => {
      await page.keyboard.press('KeyR');
      await sleep(600);
      assert.equal((await videoState(getFrame(page))).rate, 4, 'rate should be 4x');
    });
    await runTest('Muted autoplay: M unmutes and the player keeps it unmuted', async () => {
      await page.goto(`http://localhost:${host.port}/kaltura-autoplay.html`, {
        waitUntil: 'domcontentloaded',
      });
      const frame = await (async () => {
        for (let i = 0; i < 60; i++) {
          const f = getFrame(page);
          if (f) {
            return f;
          }
          await sleep(500);
        }
        return null;
      })();
      assert.true(!!frame, 'Kaltura frame should exist');
      await frame.waitForSelector('vsc-controller', { timeout: 90000 });
      await frame.waitForFunction(
        () => {
          const v = document.querySelector('video');
          return v && v.readyState >= 3 && !v.paused;
        },
        { timeout: 90000 }
      );
      await sleep(1000);
      // The test browser may allow unmuted autoplay (earlier clicks grant
      // activation). Put the player into the same state its muted-autoplay
      // fallback produces, through Kaltura's own player API.
      await frame.evaluate(() => {
        const players = window.KalturaPlayer.getPlayers();
        const player = players[Object.keys(players)[0]];
        player.muted = true;
      });
      await sleep(500);
      const start = await videoState(frame);
      assert.true(start.muted, `player should start muted (muted=${start.muted})`);

      await page.evaluate(() => document.body.focus());
      await page.keyboard.press('KeyM');
      await sleep(500);
      assert.true(!(await videoState(frame)).muted, 'M should unmute');
      await sleep(2000);
      const later = await videoState(frame);
      assert.true(!later.muted, 'player must not re-mute after M');
      assert.true(!later.paused, 'video should keep playing');
    });
  } catch (error) {
    console.log(`   💥 Suite error: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
    host.server.close();
  }

  return { passed, failed };
}

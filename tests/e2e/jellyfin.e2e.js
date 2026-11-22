/**
 * Jellyfin E2E test (network-dependent, opt-in: `node tests/e2e/run-e2e.js jellyfin`).
 * Signs in to the public Jellyfin demo server, plays a series episode and
 * checks the shortcuts against Jellyfin's own key handlers (K, L, J, M are
 * bound by both), the controller's placement under the player's OSD header,
 * and that the speed survives moving to the next episode.
 *
 * The demo server resets daily and its content can change; the episode is
 * looked up by series name rather than hard-coded by id.
 */

import { launchChromeWithExtension, assert, sleep } from './e2e-utils.js';

const SERVER = process.env.JELLYFIN_URL || 'https://demo.jellyfin.org/stable';
const USER = process.env.JELLYFIN_USER || 'demo';
const PASSWORD = process.env.JELLYFIN_PASSWORD || '';
const AUTH_HEADER =
  'MediaBrowser Client="vsc-e2e", Device="vsc-e2e", DeviceId="vsc-e2e", Version="1.0"';

/** Find the first episode of a series with at least two episodes. */
async function findEpisode() {
  const auth = await fetch(`${SERVER}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH_HEADER },
    body: JSON.stringify({ Username: USER, Pw: PASSWORD }),
  }).then((r) => r.json());
  const headers = { Authorization: `MediaBrowser Token="${auth.AccessToken}"` };
  const query = new URLSearchParams({
    userId: auth.User.Id,
    IncludeItemTypes: 'Episode',
    Recursive: 'true',
    SortBy: 'SeriesSortName,ParentIndexNumber,IndexNumber',
    Limit: '50',
  });
  const { Items } = await fetch(`${SERVER}/Items?${query}`, { headers }).then((r) => r.json());
  const first = Items.find(
    (ep, i) => Items[i + 1] && Items[i + 1].SeriesId === ep.SeriesId && ep.RunTimeTicks > 6e9
  );
  if (!first) {
    throw new Error('no series with two episodes on the demo server');
  }
  return first.Id;
}

export default async function runJellyfinE2ETests() {
  console.log('🎭 Running Jellyfin E2E Tests...\n');

  let browser;
  let passed = 0;
  let failed = 0;

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

  try {
    const episodeId = await findEpisode();
    const { browser: chromeBrowser, page } = await launchChromeWithExtension();
    browser = chromeBrowser;

    const videoState = () =>
      page.evaluate(() => {
        const v = document.querySelector('video');
        return {
          rate: v.playbackRate,
          time: v.currentTime,
          paused: v.paused,
          muted: v.muted,
          src: v.currentSrc,
          controllers: document.querySelectorAll('vsc-controller').length,
        };
      });
    const waitPlaying = () =>
      page.waitForFunction(
        () => {
          const v = document.querySelector('video');
          return v && v.readyState >= 3 && !v.paused;
        },
        { timeout: 90000 }
      );
    // The OSD (header and bottom bar) is display:none until the mouse moves.
    const showOsd = async () => {
      await page.mouse.move(600, 300);
      await page.mouse.move(620, 320);
      await page.waitForSelector('.btnVideoOsdSettings', { visible: true, timeout: 10000 });
      await sleep(300);
    };
    const clickOsdButton = async (selector) => {
      await showOsd();
      await (await page.waitForSelector(selector, { visible: true })).click();
    };
    // Rect of the OSD back button: the leftmost rendered button in the
    // header. Jellyfin keeps a hidden legacy header in the DOM as well, so a
    // plain selector can match an invisible button first.
    const backButtonRect = () =>
      page.evaluate(() => {
        const r = [...document.querySelectorAll('.osdHeader button')]
          .map((b) => b.getBoundingClientRect())
          .filter((rect) => rect.height > 0)
          .sort((a, b) => a.left - b.left)[0];
        return r ? { left: r.left, top: r.top, bottom: r.bottom, width: r.width } : null;
      });

    const setupPassed = passed;
    await runTest('Jellyfin episode plays with a controller attached', async () => {
      await page.goto(`${SERVER}/web/#/login`, { waitUntil: 'networkidle2' });
      // The login page lists public users first; the (initially hidden)
      // manual form sits behind the "Manual Login" button.
      const manual = await page.waitForSelector('.btnManual', { visible: true, timeout: 30000 });
      await manual.click();
      await page.waitForSelector('#txtManualName', { visible: true });
      await page.type('#txtManualName', USER);
      if (PASSWORD) {
        await page.type('#txtManualPassword', PASSWORD);
      }
      await page.click('.manualLoginForm button[type=submit]');
      await page.waitForFunction(() => !location.hash.includes('login'), { timeout: 30000 });

      await page.goto(`${SERVER}/web/#/details?id=${episodeId}`, { waitUntil: 'networkidle2' });
      const play = await page.waitForSelector('.mainDetailButtons .btnPlay', {
        visible: true,
        timeout: 30000,
      });
      await play.click();
      await waitPlaying();
      await page.waitForSelector('.videoPlayerContainer ~ vsc-controller', { timeout: 30000 });
      await sleep(1000);
      assert.equal((await videoState()).controllers, 1, 'one controller');
    });
    if (passed === setupPassed) {
      throw new Error('setup failed; skipping the remaining tests');
    }

    await runTest('Controller sits below the OSD header, not behind the back button', async () => {
      await showOsd();
      const back = await backButtonRect();
      const layout = await page.evaluate(() => {
        const host = document.querySelector('vsc-controller');
        const ctrl = host.shadowRoot.querySelector('#controller').getBoundingClientRect();
        const hit = document.elementFromPoint(
          ctrl.left + ctrl.width / 2,
          ctrl.top + ctrl.height / 2
        );
        return {
          ctrlTop: ctrl.top,
          ctrlLeft: ctrl.left,
          ctrlOnTop: hit === host,
          hitName: hit && `${hit.tagName}.${hit.className}`,
        };
      });
      assert.true(!!back, 'OSD back button should be visible');
      layout.backBottom = back.bottom;
      assert.true(
        layout.ctrlTop >= layout.backBottom,
        `controller top ${layout.ctrlTop} should be below the back button (${layout.backBottom})`
      );
      assert.true(layout.ctrlTop < layout.backBottom + 40, 'controller stays near the top');
      assert.true(layout.ctrlLeft < 40, 'controller stays at the left edge');
      assert.true(layout.ctrlOnTop, `nothing should cover the controller (hit ${layout.hitName})`);
    });

    await runTest('W sets 2x', async () => {
      await page.keyboard.press('KeyW');
      await sleep(600);
      assert.equal((await videoState()).rate, 2, 'rate should be 2x');
    });

    await runTest('K pauses and resumes (Jellyfin K handler must not undo it)', async () => {
      await page.keyboard.press('KeyK');
      await sleep(800);
      assert.true((await videoState()).paused, 'video should be paused');
      await page.keyboard.press('KeyK');
      await sleep(800);
      assert.true(!(await videoState()).paused, 'video should be playing');
    });

    await runTest('L advances about 10 seconds (no double seek from Jellyfin)', async () => {
      const before = (await videoState()).time;
      await page.keyboard.press('KeyL');
      await sleep(300);
      const after = (await videoState()).time;
      assert.true(after - before >= 9 && after - before <= 12, `advanced ${after - before}s`);
      await waitPlaying();
    });

    await runTest('J rewinds about 10 seconds', async () => {
      const before = (await videoState()).time;
      await page.keyboard.press('KeyJ');
      await sleep(300);
      const after = (await videoState()).time;
      assert.true(before - after >= 8 && before - after <= 11, `rewound ${before - after}s`);
      await waitPlaying();
    });

    await runTest('M toggles mute (Jellyfin M handler must not undo it)', async () => {
      const before = (await videoState()).muted;
      await page.keyboard.press('KeyM');
      await sleep(600);
      assert.equal((await videoState()).muted, !before, 'muted should flip');
      await page.keyboard.press('KeyM');
      await sleep(600);
      assert.equal((await videoState()).muted, before, 'muted should flip back');
    });

    await runTest('Holding Shift runs 8x, release restores 2x', async () => {
      await page.keyboard.down('ShiftLeft');
      await sleep(600);
      assert.equal((await videoState()).rate, 8, 'rate should be 8x while held');
      await page.keyboard.up('ShiftLeft');
      await sleep(600);
      assert.equal((await videoState()).rate, 2, 'rate should return to 2x');
    });

    await runTest('Next episode keeps 2x', async () => {
      const before = (await videoState()).src;
      await clickOsdButton('.btnNextTrack');
      await page.waitForFunction(
        (src) => document.querySelector('video')?.currentSrc !== src,
        {
          timeout: 30000,
        },
        before
      );
      await waitPlaying();
      await sleep(2000);
      const state = await videoState();
      assert.equal(state.rate, 2, 'rate should still be 2x');
      assert.equal(state.controllers, 1, 'still one controller');
    });

    await runTest("Jellyfin's playback speed menu reflects the speed", async () => {
      await clickOsdButton('.btnVideoOsdSettings');
      const label = await page.waitForFunction(
        () =>
          [...document.querySelectorAll('.actionSheetMenuItem')]
            .map((b) => b.textContent)
            .find((t) => t.startsWith('Playback Speed')),
        { timeout: 10000 }
      );
      assert.equal(await label.jsonValue(), 'Playback Speed2x', 'menu should show 2x');
      // Escape closes the sheet. Jellyfin then ignores the next click on its
      // Next button (seen without the extension too), so this test runs
      // after the next-episode test.
      await page.keyboard.press('Escape');
      await sleep(500);
    });

    await runTest('Leaving the player removes the controller', async () => {
      // The previous test closed Jellyfin's settings sheet with Escape, after
      // which Jellyfin ignores the first click on the OSD (with or without
      // the extension). Click the back button again if the player is still up.
      for (let attempt = 0; attempt < 2; attempt++) {
        await showOsd();
        const back = await backButtonRect();
        assert.true(!!back, 'OSD back button should be visible');
        await page.mouse.click(back.left + back.width / 2, (back.top + back.bottom) / 2);
        const left = await page
          .waitForFunction(() => !document.querySelector('video'), { timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        if (left) {
          break;
        }
      }
      await page.waitForFunction(() => !document.querySelector('video'), { timeout: 10000 });
      await sleep(1000);
      const controllers = await page.evaluate(
        () => document.querySelectorAll('vsc-controller').length
      );
      assert.equal(controllers, 0, 'no controller should be left behind');
    });
  } catch (error) {
    console.log(`   💥 Suite error: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return { passed, failed };
}

# [Install from Chrome Web Store][chrome-web-store-link]

[![Chrome Web Store][chrome-web-store-version]][chrome-web-store-link] [![Chrome Web Store Users][chrome-web-store-users-badge]][chrome-web-store-link] [![Chrome Web Store Users][chrome-web-store-stars]][chrome-web-store-link]

**Video Speed Controller** gives you fine-grained control over any HTML5 video
or audio element, on any site.

## The science of accelerated playback

**TL;DR** -- faster playback translates to better engagement and retention.

The average adult reads at [250-300 words per minute][wpm-study] (wpm). Speech
averages ~150 wpm; slide presentations often closer to 100 wpm. Given the
choice, most viewers [speed up playback to ~1.3-1.5x][ms-study] to close the
gap. Accelerated viewing [keeps attention longer][byu-study] -- faster delivery
means higher engagement. With practice, many settle at 2x or above and find it
[uncomfortable to return to 1x][mit-study].

[wpm-study]: http://www.paperbecause.com/PIOP/files/f7/f7bb6bc5-2c4a-466f-9ae7-b483a2c0dca4.pdf
[ms-study]: http://research.microsoft.com/en-us/um/redmond/groups/coet/compression/chi99/paper.pdf
[byu-study]: http://www.enounce.com/docs/BYUPaper020319.pdf
[mit-study]: http://alumni.media.mit.edu/~barons/html/avios92.html#beasleyalteredspeech

HTML5 media elements expose a native playback rate API, but most players hide
or artificially limit it. Speed adjustments should be effortless and frequent:
we don't read at a fixed pace, and we shouldn't watch at one either.

## Features

- **Universal** - works on any site with HTML5 media: YouTube, Netflix,
  Coursera, podcasts, local files, etc.
- **Video and audio** - controls both `<video>` and `<audio>` elements.
- **Fine-grained speed** - 0.07x to 16x in configurable increments.
- **Per-site speed rules** - set a default playback speed for specific domains
  (e.g., always 2x on lecture sites).
- **Per-site disable** - turn off the controller on sites where you don't
  want it.
- **Remember speed** - optionally persist your last speed across sessions
  and tabs.
- **Speed fightback** - automatically re-applies your chosen speed when a
  site's player tries to reset it.
- **Draggable overlay** - reposition the on-video speed indicator anywhere
  you like.
- **Fully customizable shortcuts** - remap every key, add modifier combos
  (Ctrl, Shift, Alt), create multiple preferred-speed toggles.
- **Custom controller CSS** - style or reposition the overlay with your own
  CSS rules.

## About this fork

This is a fork of [igrigorik/videospeed][github-release-link] with two changes:

- **Cross-frame shortcuts.** Upstream only handles a shortcut in the frame
  that has keyboard focus. Players embedded in a cross-origin iframe (Kaltura
  in Canvas, Moodle, MediaSpace, and similar) therefore ignore shortcuts unless
  you first click inside the player. This fork forwards a matching shortcut
  from any frame of the tab to the frames that control media, so keys work no
  matter where focus is. The overlay controller is unchanged.
- **Works in the Kaltura V2 (kWidget) player.** V2 builds its player by
  writing HTML into a blank iframe from the parent page. Upstream refuses to
  run in blank frames, and the rewrite erases every event listener anyway.
  This fork resolves the frame's site from its same-origin parent and rebinds
  its listeners whenever the frame's root element is replaced.
- **Shortcuts win over the player's own keys.** Key listeners run in the
  window capture phase and "Exclusive keyboard shortcuts" is on by default,
  so a key bound in this extension is not also handled by the page. Without
  this, Kaltura's own K handler toggles play and ours toggles it straight
  back. Turn the option off in settings if you want the page to see the
  keys too.
- **Extra default shortcuts**, added as custom rows on the settings page:

  | Key          | Action                                   |
  | ------------ | ---------------------------------------- |
  | Q            | set speed to 1x                          |
  | W            | set speed to 2x                          |
  | E            | set speed to 3x                          |
  | R            | set speed to 4x                          |
  | J            | rewind 10 seconds                        |
  | K            | play / pause                             |
  | L            | advance 10 seconds                       |
  | Shift (held) | 8x while held, previous speed on release |

  Custom rows take precedence over the built-in rows on the same key, so R
  sets 4x rather than resetting, and J rewinds rather than jumping to the
  marker. Delete a custom row in settings to get the built-in behavior back.
  Two new actions are available in the action dropdown: "Set speed"
  (absolute speed) and "Hold speed while key is held". The hold value is
  editable like any other row, and hold is the one action that accepts a
  modifier key on its own.

### Build and load

```
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose "Load
unpacked" and select the `dist` folder. Note that recent branded Chrome
builds ignore the `--load-extension` flag, so the E2E suite needs Chrome for
Testing (`npx puppeteer browsers install chrome@stable`) and
`PUPPETEER_EXECUTABLE_PATH` pointing at it. `node tests/e2e/run-e2e.js kaltura`
runs an extra suite against a public Kaltura sample player (needs network).

## Default keyboard shortcuts

- **S** - decrease playback speed
- **D** - increase playback speed
- **R** - reset playback speed to 1.0x
- **Z** - rewind video by 10 seconds
- **X** - advance video by 10 seconds
- **G** - toggle between current and preferred speed
- **V** - show/hide the controller
- **M** - set a marker at current position
- **J** - jump back to the previously set marker

All shortcuts are fully customizable in the extension's settings page. You can
reassign keys, add modifier combinations, and define multiple preferred-speed
shortcuts with different values for quick toggling. Click **Add New** in
settings to create additional bindings. Refresh the page after making changes
for them to take effect.

## License

(MIT License) - Copyright (c) 2014 Ilya Grigorik

[chrome-web-store-version]: https://img.shields.io/chrome-web-store/v/nffaoalbilbmmfgbnbgppjihopabppdk?label=Chrome%20Web%20Store
[chrome-web-store-users-badge]: https://img.shields.io/chrome-web-store/users/nffaoalbilbmmfgbnbgppjihopabppdk
[chrome-web-store-stars]: https://img.shields.io/chrome-web-store/stars/nffaoalbilbmmfgbnbgppjihopabppdk
[github-release-badge]: https://img.shields.io/github/v/release/igrigorik/videospeed
[chrome-web-store-link]: https://chromewebstore.google.com/detail/video-speed-controller/nffaoalbilbmmfgbnbgppjihopabppdk
[github-release-link]: https://github.com/igrigorik/videospeed/releases

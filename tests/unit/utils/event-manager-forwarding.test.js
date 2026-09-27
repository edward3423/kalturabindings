/**
 * Tests for the fork's additions to EventManager:
 * - default custom bindings (Q/W/E/R speeds, J/K/L transport)
 * - custom bindings shadow predefined bindings on the same key
 * - shortcuts pressed in a frame without media are forwarded, and
 *   forwarded shortcuts are applied in frames that control media
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

let mockDOM;

function setupEnv({ withMedia = true, keyBindings } = {}) {
  const config = window.VSC.videoSpeedConfig;
  config._loaded = true;
  config.settings.keyBindings = keyBindings || window.VSC.Constants.DEFAULT_SETTINGS.keyBindings;

  const actions = [];
  const actionHandler = {
    runAction: (action, value, _event) => actions.push({ action, value }),
  };
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  if (withMedia) {
    const video = createMockVideo({ playbackRate: 1.0 });
    if (!video.parentElement) {
      mockDOM.container.appendChild(video);
    }
    video.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.00' } };
    window.VSC.stateManager.controllers.set('test-video', {
      id: 'test-video',
      element: video,
      videoSrc: 'test',
      tagName: 'VIDEO',
      created: Date.now(),
      isActive: true,
    });
  }

  return { config, eventManager, actions };
}

function makeEvent(overrides = {}) {
  return {
    code: overrides.code || '',
    key: overrides.key || '',
    keyCode: overrides.keyCode || 0,
    ctrlKey: overrides.ctrlKey || false,
    altKey: overrides.altKey || false,
    shiftKey: overrides.shiftKey || false,
    metaKey: overrides.metaKey || false,
    isComposing: false,
    timeStamp: overrides.timeStamp || Date.now(),
    type: 'keydown',
    target: overrides.target || document.body,
    preventDefault: overrides.preventDefault || (() => {}),
    stopPropagation: () => {},
  };
}

describe('EventManager fork additions', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();
    window.VSC.stateManager.controllers.clear();
  });

  afterEach(() => {
    window.VSC.stateManager.controllers.clear();
    mockDOM?.cleanup?.();
    cleanupChromeMock();
  });

  it('ships Q/W/E/R as absolute speeds and J/K/L as transport by default', () => {
    const { eventManager, actions } = setupEnv();
    const presses = [
      ['KeyQ', 81],
      ['KeyW', 87],
      ['KeyE', 69],
      ['KeyR', 82],
      ['KeyJ', 74],
      ['KeyK', 75],
      ['KeyL', 76],
    ];
    presses.forEach(([code, keyCode], i) => {
      eventManager.handleKeydown(makeEvent({ code, keyCode, timeStamp: 1000 + i }));
    });
    expect(actions).toEqual([
      { action: 'speed', value: 1 },
      { action: 'speed', value: 2 },
      { action: 'speed', value: 3 },
      { action: 'speed', value: 4 },
      { action: 'rewind', value: 10 },
      { action: 'pause', value: 0 },
      { action: 'advance', value: 10 },
    ]);
  });

  it('custom binding wins over a predefined binding on the same key regardless of order', () => {
    const keyBindings = [
      { action: 'reset', code: 'KeyR', keyCode: 82, value: 1, predefined: true },
      { action: 'speed', code: 'KeyR', keyCode: 82, value: 4, predefined: false },
    ];
    const { eventManager, actions } = setupEnv({ keyBindings });
    eventManager.handleKeydown(makeEvent({ code: 'KeyR', keyCode: 82 }));
    expect(actions).toEqual([{ action: 'speed', value: 4 }]);
  });

  it('predefined bindings still fire when no custom binding shares the key', () => {
    const { eventManager, actions } = setupEnv();
    eventManager.handleKeydown(makeEvent({ code: 'KeyS', keyCode: 83 }));
    expect(actions).toEqual([{ action: 'slower', value: 0.1 }]);
  });

  it('forwards a matching shortcut when this frame controls no media', () => {
    const { eventManager, actions } = setupEnv({ withMedia: false });
    const forwarded = [];
    const listener = (e) => forwarded.push(e.detail);
    document.documentElement.addEventListener('VSC_FORWARD_KEY', listener);

    eventManager.handleKeydown(makeEvent({ code: 'KeyW', key: 'w', keyCode: 87 }));

    document.documentElement.removeEventListener('VSC_FORWARD_KEY', listener);
    expect(actions).toEqual([]);
    expect(forwarded).toEqual([
      {
        code: 'KeyW',
        key: 'w',
        keyCode: 87,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
      },
    ]);
  });

  it('does not forward keys that match no binding', () => {
    const { eventManager } = setupEnv({ withMedia: false });
    const forwarded = [];
    const listener = (e) => forwarded.push(e.detail);
    document.documentElement.addEventListener('VSC_FORWARD_KEY', listener);

    eventManager.handleKeydown(makeEvent({ code: 'KeyP', key: 'p', keyCode: 80 }));

    document.documentElement.removeEventListener('VSC_FORWARD_KEY', listener);
    expect(forwarded).toEqual([]);
  });

  it('does not forward keys typed into an input', () => {
    const { eventManager } = setupEnv({ withMedia: false });
    const forwarded = [];
    const listener = (e) => forwarded.push(e.detail);
    document.documentElement.addEventListener('VSC_FORWARD_KEY', listener);

    const input = document.createElement('input');
    eventManager.handleKeydown(makeEvent({ code: 'KeyW', keyCode: 87, target: input }));

    document.documentElement.removeEventListener('VSC_FORWARD_KEY', listener);
    expect(forwarded).toEqual([]);
  });

  it('honors exclusiveKeys when forwarding', () => {
    const { config, eventManager } = setupEnv({ withMedia: false });
    config.settings.exclusiveKeys = true;
    let prevented = false;
    eventManager.handleKeydown(
      makeEvent({ code: 'KeyW', keyCode: 87, preventDefault: () => (prevented = true) })
    );
    config.settings.exclusiveKeys = false;
    expect(prevented).toBe(true);
  });

  it('applies a forwarded shortcut when this frame controls media', () => {
    const { eventManager, actions } = setupEnv();
    const handled = eventManager.handleForwardedKey({
      code: 'KeyE',
      key: 'e',
      keyCode: 69,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(handled).toBe(true);
    expect(actions).toEqual([{ action: 'speed', value: 3 }]);
  });

  it('ignores a forwarded shortcut when this frame controls no media', () => {
    const { eventManager, actions } = setupEnv({ withMedia: false });
    const handled = eventManager.handleForwardedKey({ code: 'KeyE', keyCode: 69 });
    expect(handled).toBe(false);
    expect(actions).toEqual([]);
  });

  it('ignores malformed forwarded payloads', () => {
    const { eventManager, actions } = setupEnv();
    expect(eventManager.handleForwardedKey(null)).toBe(false);
    expect(eventManager.handleForwardedKey('KeyE')).toBe(false);
    expect(actions).toEqual([]);
  });
});

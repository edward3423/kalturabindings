/**
 * Unit tests for JellyfinHandler: DOM-based detection (Jellyfin is
 * self-hosted, so there is no hostname to match) and the controller CSS that
 * moves the controller below the player's OSD header.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

function addMeta(content) {
  const meta = document.createElement('meta');
  meta.name = 'application-name';
  meta.content = content;
  document.head.appendChild(meta);
  return meta;
}

describe('JellyfinHandler', () => {
  let meta;

  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    window.VSC.siteHandlerManager.refresh();
  });

  afterEach(() => {
    meta?.remove();
    meta = null;
    window.VSC.siteHandlerManager.refresh();
    cleanupChromeMock();
  });

  it('matches a page that declares application-name Jellyfin', () => {
    meta = addMeta('Jellyfin');
    expect(window.VSC.JellyfinHandler.matches()).toBe(true);
  });

  it('does not match other pages', () => {
    expect(window.VSC.JellyfinHandler.matches()).toBe(false);
    meta = addMeta('Emby');
    expect(window.VSC.JellyfinHandler.matches()).toBe(false);
  });

  it('is selected by the site handler manager on any hostname', () => {
    meta = addMeta('Jellyfin');
    expect(window.VSC.siteHandlerManager.getCurrentHandler()).toBeInstanceOf(
      window.VSC.JellyfinHandler
    );
  });

  it('inserts the player controller after .videoPlayerContainer, outside its stacking context', () => {
    const container = document.createElement('div');
    container.className = 'videoPlayerContainer';
    const video = document.createElement('video');
    container.appendChild(video);
    document.body.appendChild(container);
    try {
      const handler = new window.VSC.JellyfinHandler();
      expect(handler.getControllerPosition(container, video)).toEqual({
        insertionPoint: container,
        insertionMethod: 'afterParent',
        targetParent: document.body,
      });
    } finally {
      container.remove();
    }
  });

  it('keeps the default insertion for other media (e.g. the audio player)', () => {
    const parent = document.createElement('div');
    const audio = document.createElement('audio');
    parent.appendChild(audio);
    const handler = new window.VSC.JellyfinHandler();
    expect(handler.getControllerPosition(parent, audio)).toEqual({
      insertionPoint: parent,
      insertionMethod: 'firstChild',
      targetParent: parent,
    });
  });

  it('offsets the controller below the 48px OSD header without making it relative', () => {
    meta = addMeta('Jellyfin');
    const css = window.VSC.siteHandlerManager.getControllerCSS();
    expect(css).toContain('.videoPlayerContainer ~ vsc-controller');
    expect(css).toMatch(/top:\s*48px/);
    // The host stays absolute so the inner controller's computed offset
    // (the video's position) still applies.
    expect(css).not.toMatch(/position:\s*relative/);
  });

  it('adds no controller CSS on non-Jellyfin pages', () => {
    expect(window.VSC.siteHandlerManager.getControllerCSS()).toBe('');
  });
});

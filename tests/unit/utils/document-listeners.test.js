/**
 * DocumentListeners: root-element listeners that survive a document rewrite
 * (document.open() replaces the root and erases all listeners).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

function replaceRoot() {
  const fresh = document.createElement('html');
  fresh.appendChild(document.createElement('head'));
  fresh.appendChild(document.createElement('body'));
  document.replaceChild(fresh, document.documentElement);
  return fresh;
}

describe('DocumentListeners', () => {
  let originalRoot;

  beforeEach(async () => {
    originalRoot = document.documentElement;
    await import('../../../src/utils/document-listeners.js');
  });

  afterEach(() => {
    if (document.documentElement !== originalRoot) {
      document.replaceChild(originalRoot, document.documentElement);
    }
  });

  it('delivers events dispatched on the current root', () => {
    const registry = window.VSC.DocumentListeners;
    const seen = [];
    const handler = (e) => seen.push(e.detail);
    registry.add('VSC_TEST_EVENT', handler);
    registry.dispatch('VSC_TEST_EVENT', { n: 1 });
    registry.remove('VSC_TEST_EVENT', handler);
    registry.dispatch('VSC_TEST_EVENT', { n: 2 });
    expect(seen).toEqual([{ n: 1 }]);
  });

  it('rebinds listeners and notifies rewrite callbacks when the root is replaced', async () => {
    const registry = window.VSC.DocumentListeners;
    const seen = [];
    let rewrites = 0;
    const handler = (e) => seen.push(e.detail);
    registry.add('VSC_TEST_REBIND', handler);
    registry.onRewrite(() => rewrites++);

    const fresh = replaceRoot();
    await flush();

    fresh.dispatchEvent(new CustomEvent('VSC_TEST_REBIND', { detail: 'after' }));
    registry.dispatch('VSC_TEST_REBIND', 'via-registry');
    registry.remove('VSC_TEST_REBIND', handler);

    expect(rewrites).toBe(1);
    expect(seen).toEqual(['after', 'via-registry']);
  });
});

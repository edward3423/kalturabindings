/**
 * Listeners bound to the document's root element that survive a rewrite.
 *
 * document.open() (used by the Kaltura V2 player, which writes its player
 * HTML into a blank iframe from the parent page) keeps the Window and
 * Document objects but replaces the root element and erases every event
 * listener on the window, the document and all of its descendants. Anything
 * this extension registered before the rewrite is silently gone.
 *
 * This registry binds listeners to whatever the current root element is,
 * watches the document for a root replacement, rebinds on the new root and
 * lets other modules re-register their own window/document listeners.
 */

window.VSC = window.VSC || {};

class DocumentListeners {
  constructor() {
    this.handlers = [];
    this.rewriteCallbacks = [];
    this.boundRoot = null;
    this.observer = null;
  }

  /**
   * Register a listener on the current root element; rebound after rewrites.
   * @param {string} type
   * @param {Function} handler
   */
  add(type, handler) {
    this.handlers.push({ type, handler });
    this.ensureWatching();
    const root = document.documentElement;
    if (root) {
      if (root !== this.boundRoot) {
        this.rebind(root);
      } else {
        root.addEventListener(type, handler);
      }
    }
  }

  /**
   * Remove a previously added listener.
   * @param {string} type
   * @param {Function} handler
   */
  remove(type, handler) {
    this.handlers = this.handlers.filter((h) => !(h.type === type && h.handler === handler));
    this.boundRoot?.removeEventListener(type, handler);
  }

  /**
   * Dispatch a CustomEvent on the current root element.
   * @param {string} type
   * @param {*} [detail]
   */
  dispatch(type, detail) {
    const root = document.documentElement;
    if (!root) {
      return;
    }
    root.dispatchEvent(new CustomEvent(type, detail === undefined ? undefined : { detail }));
  }

  /**
   * Run a callback after the root element was replaced (listeners on window
   * and document were erased by then).
   * @param {Function} callback
   */
  onRewrite(callback) {
    this.rewriteCallbacks.push(callback);
    this.ensureWatching();
  }

  /** @private */
  ensureWatching() {
    if (this.observer || typeof MutationObserver !== 'function') {
      return;
    }
    this.observer = new MutationObserver(() => this.checkRoot());
    this.observer.observe(document, { childList: true });
  }

  /** @private */
  checkRoot() {
    const root = document.documentElement;
    if (!root || root === this.boundRoot) {
      return;
    }
    this.rebind(root);
    for (const callback of this.rewriteCallbacks) {
      try {
        callback();
      } catch (error) {
        window.VSC.logger?.error?.(`Rewrite callback failed: ${error.message}`);
      }
    }
  }

  /** @private */
  rebind(root) {
    this.boundRoot = root;
    for (const { type, handler } of this.handlers) {
      root.addEventListener(type, handler);
    }
  }
}

window.VSC.DocumentListeners = new DocumentListeners();

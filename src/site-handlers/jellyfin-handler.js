/**
 * Jellyfin-specific handler
 *
 * Jellyfin is self-hosted, so there is no hostname to match. Every Jellyfin
 * web client ships <meta name="application-name" content="Jellyfin"> in its
 * static index.html, which is present by the time inject.js runs.
 *
 * Playback, speed and seeking go through the plain <video> element and need
 * nothing special. The problem is layout. The player's <video> lives in
 * body > .videoPlayerContainer, a position:fixed box and therefore its own
 * stacking context, while the OSD header (back button and title) is a later
 * body-level layer. That header covers the top-left corner where the
 * controller is drawn: its toolbar is 48px tall, and while the OSD is shown
 * the header box extends further down as a transparent, click-catching area.
 * Inside the container no z-index can lift the controller above it, so the
 * controller is hidden behind the back button and cannot be clicked or
 * dragged while the OSD is up.
 *
 * Fix: insert the controller as a body-level sibling right after the
 * container, where its own z-index competes in the root stacking context,
 * and shift it below the 48px toolbar so it does not cover the back button.
 */

window.VSC = window.VSC || {};

class JellyfinHandler extends window.VSC.BaseSiteHandler {
  static matches() {
    return !!document.querySelector('meta[name="application-name"][content="Jellyfin"]');
  }

  getControllerPosition(parent, video) {
    if (parent.classList.contains('videoPlayerContainer') && parent.parentElement) {
      return {
        insertionPoint: parent,
        insertionMethod: 'afterParent',
        targetParent: parent.parentElement,
      };
    }
    return super.getControllerPosition(parent, video);
  }

  getControllerCSS() {
    // The host stays position:absolute (inject.css). The inner controller is
    // placed at the video's offset, which is (0,0) for the full-viewport
    // player, so this offset alone clears the toolbar.
    return `.videoPlayerContainer ~ vsc-controller {
  top: 48px;
}`;
  }
}

window.VSC.JellyfinHandler = JellyfinHandler;

/**
 * Shared Lottie boot snippet for internal HTML pages (OPP-33).
 *
 * file-browser and tabs-storage both inline the same two <script> tags to load
 * the bundled lottie player and boot the loading animation into an element with
 * id="lottie". The container element (sizing/class) stays per-page; only this
 * boot code is shared. The player JS and animation JSON are baked at build time
 * by electron-vite.
 */
declare const __LOTTIE_PLAYER_JS__: string
declare const __LOADING_ANIMATION_JSON__: object

/**
 * The lottie player <script> plus the loadAnimation boot call targeting
 * `#lottie`. Caller supplies the `<div id="lottie">` container itself.
 */
export function renderLottieBoot(): string {
  const animJson = JSON.stringify(__LOADING_ANIMATION_JSON__)
  return `<script>${__LOTTIE_PLAYER_JS__}</script>
  <script>
    try {
      lottie.loadAnimation({
        container: document.getElementById('lottie'),
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: ${animJson}
      });
    } catch(e) {}
  </script>`
}

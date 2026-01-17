/**
 * BrowserView factory for tab content.
 * Creates isolated views with TON proxy configured.
 */

import { BrowserView, session } from 'electron'
import { USER_AGENT } from '../../shared/constants'
import { getSetting } from '../settings'

const SESSION_PARTITION = 'persist:ton-browser'

export function createTonSession(proxyPort: number) {
  const ses = session.fromPartition(SESSION_PARTITION)

  // Configure proxy - route ALL requests through proxy (no bypass)
  ses.setProxy({
    proxyRules: `http://127.0.0.1:${proxyPort}`,
  })

  // Block all permissions by default (privacy)
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  // Set uniform User-Agent
  ses.setUserAgent(USER_AGENT)

  // Privacy: Normalize headers, strip referer and ETag tracking headers
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    headers['User-Agent'] = USER_AGENT
    headers['Accept-Language'] = 'en-US,en;q=0.9'
    // Strip referer to prevent navigation history leaks
    delete headers['Referer']
    delete headers['Referrer']
    // Strip ETag-related headers to prevent tracking (but allow local cache)
    delete headers['If-None-Match']
    delete headers['If-Modified-Since']
    // Optional: Force no-cache for maximum privacy (user setting)
    const { disableCache } = getSetting('privacy')
    if (disableCache) {
      headers['Cache-Control'] = 'no-cache'
      headers['Pragma'] = 'no-cache'
    }
    callback({ requestHeaders: headers })
  })

  // Privacy: Enforce no-referrer policy and strip ETag from responses
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Referrer-Policy'] = ['no-referrer']
    // Strip ETag to prevent tracking identifiers
    delete headers['ETag']
    delete headers['etag']
    callback({ responseHeaders: headers })
  })

  return ses
}

export function createBrowserView(ses: Electron.Session): BrowserView {
  const view = new BrowserView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })

  // Privacy: Disable tracking APIs on every page load
  view.webContents.on('dom-ready', () => {
    view.webContents.executeJavaScript(`
      (function() {
        'use strict';

        // === CANVAS FINGERPRINT PROTECTION ===
        // Inject deterministic noise to canvas readouts (stable per session)
        const sessionSeed = Math.random();

        const noisifyCanvasData = (original, width, height) => {
          const data = new Uint8ClampedArray(original);
          // Inject subtle noise (±1-2 in RGB) - imperceptible but changes hash
          for (let i = 0; i < data.length; i += 4) {
            const noise = ((sessionSeed * (i % 233)) % 3) - 1; // deterministic noise
            data[i] = Math.max(0, Math.min(255, data[i] + noise));     // R
            data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise)); // G
            data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise)); // B
          }
          return data;
        };

        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function(...args) {
          const imageData = originalGetImageData.apply(this, args);
          imageData.data.set(noisifyCanvasData(imageData.data, args[2], args[3]));
          return imageData;
        };

        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(...args) {
          const ctx = this.getContext('2d');
          if (!ctx) return originalToDataURL.apply(this, args);

          // Save original canvas state
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          const noisedData = ctx.createImageData(this.width, this.height);
          noisedData.data.set(noisifyCanvasData(imageData.data, this.width, this.height));

          // Temporarily apply noise, export, then restore
          ctx.putImageData(noisedData, 0, 0);
          const result = originalToDataURL.apply(this, args);
          ctx.putImageData(imageData, 0, 0); // Restore original

          return result;
        };

        const originalToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function(...args) {
          const ctx = this.getContext('2d');
          if (!ctx) return originalToBlob.apply(this, args);

          // Save original canvas state
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          const noisedData = ctx.createImageData(this.width, this.height);
          noisedData.data.set(noisifyCanvasData(imageData.data, this.width, this.height));

          // Temporarily apply noise, export, then restore
          ctx.putImageData(noisedData, 0, 0);
          const callback = args[0];
          const that = this;
          const restoreCallback = function(blob) {
            ctx.putImageData(imageData, 0, 0); // Restore original
            if (callback) callback.call(that, blob);
          };
          args[0] = restoreCallback;

          return originalToBlob.apply(this, args);
        };

        // === WEBGL FINGERPRINT PROTECTION ===
        const getParameterProto = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(param) {
          const spoofed = {
            // Spoof renderer/vendor to generic values
            37445: 'Intel Inc.',              // UNMASKED_VENDOR_WEBGL
            37446: 'Intel Iris OpenGL Engine', // UNMASKED_RENDERER_WEBGL
          };
          return spoofed[param] || getParameterProto.call(this, param);
        };

        if (window.WebGL2RenderingContext) {
          const getParameterProto2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function(param) {
            const spoofed = {
              37445: 'Intel Inc.',
              37446: 'Intel Iris OpenGL Engine',
            };
            return spoofed[param] || getParameterProto2.call(this, param);
          };
        }

        // Spoof WebGL canvas rendering with noise
        const originalReadPixels = WebGLRenderingContext.prototype.readPixels;
        WebGLRenderingContext.prototype.readPixels = function(...args) {
          originalReadPixels.apply(this, args);
          const pixels = args[6];
          if (pixels) {
            for (let i = 0; i < pixels.length; i++) {
              const noise = ((sessionSeed * (i % 233)) % 3) - 1;
              pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
            }
          }
        };

        // === AUDIOCONTEXT FINGERPRINT PROTECTION ===
        const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
        if (OriginalAudioContext) {
          const originalCreateAnalyser = OriginalAudioContext.prototype.createAnalyser;
          OriginalAudioContext.prototype.createAnalyser = function() {
            const analyser = originalCreateAnalyser.call(this);
            const origGetFloatFrequencyData = analyser.getFloatFrequencyData;
            analyser.getFloatFrequencyData = function(array) {
              origGetFloatFrequencyData.call(this, array);
              // Add subtle noise to frequency data
              for (let i = 0; i < array.length; i++) {
                array[i] += (((sessionSeed * (i % 233)) % 0.001) - 0.0005);
              }
            };
            return analyser;
          };

          const originalCreateOscillator = OriginalAudioContext.prototype.createOscillator;
          OriginalAudioContext.prototype.createOscillator = function() {
            const osc = originalCreateOscillator.call(this);
            const origStart = osc.start;
            osc.start = function(...args) {
              // Add tiny frequency shift (imperceptible, changes fingerprint)
              if (osc.frequency) {
                osc.frequency.value += (sessionSeed % 0.01) - 0.005;
              }
              return origStart.apply(this, args);
            };
            return osc;
          };
        }

        // === WEBRTC IP LEAK PROTECTION ===
        if (window.RTCPeerConnection) {
          const origRTCPeerConnection = window.RTCPeerConnection;
          window.RTCPeerConnection = function(config, ...args) {
            // Force disable mDNS candidate gathering (prevents local IP leak)
            if (config) {
              config.iceServers = config.iceServers || [];
              config.iceCandidatePoolSize = 0;
            }
            const pc = new origRTCPeerConnection(config, ...args);

            // Block local IP candidates
            const origAddIceCandidate = pc.addIceCandidate;
            pc.addIceCandidate = function(candidate) {
              if (candidate && candidate.candidate) {
                // Block candidates containing local IPs (192.168, 10., 172.16-31)
                if (/((192\.168)|(10\.)|(172\.(1[6-9]|2[0-9]|3[0-1])))/.test(candidate.candidate)) {
                  console.log('[Privacy] Blocked local IP leak via WebRTC');
                  return Promise.resolve();
                }
              }
              return origAddIceCandidate.apply(this, arguments);
            };
            return pc;
          };
        }

        // === HARDWARE/PLUGIN ENUMERATION PROTECTION ===
        // Disable Battery API (fingerprinting)
        if (navigator.getBattery) {
          Object.defineProperty(navigator, 'getBattery', {
            value: () => Promise.reject('Battery API disabled for privacy'),
            writable: false
          });
        }

        // Disable Sensor APIs (fingerprinting)
        window.DeviceMotionEvent = undefined;
        window.DeviceOrientationEvent = undefined;

        // Spoof navigator.plugins (empty list)
        Object.defineProperty(navigator, 'plugins', {
          get: () => [],
          enumerable: true
        });

        // Spoof navigator.mimeTypes (empty list)
        Object.defineProperty(navigator, 'mimeTypes', {
          get: () => [],
          enumerable: true
        });

        // Spoof hardware concurrency (generic value)
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 4,
          enumerable: true
        });

        // Spoof device memory (generic value)
        if ('deviceMemory' in navigator) {
          Object.defineProperty(navigator, 'deviceMemory', {
            get: () => 8,
            enumerable: true
          });
        }

        // Spoof max touch points (generic value)
        Object.defineProperty(navigator, 'maxTouchPoints', {
          get: () => 0,
          enumerable: true
        });

        // Block Gamepad API (fingerprinting)
        if (navigator.getGamepads) {
          Object.defineProperty(navigator, 'getGamepads', {
            value: () => [],
            writable: false
          });
        }

        // Block WebUSB API (fingerprinting)
        if (navigator.usb) {
          Object.defineProperty(navigator, 'usb', {
            get: () => undefined,
            enumerable: true
          });
        }

        // Block WebBluetooth API (fingerprinting)
        if (navigator.bluetooth) {
          Object.defineProperty(navigator, 'bluetooth', {
            get: () => undefined,
            enumerable: true
          });
        }

        // Spoof screen resolution (common resolution)
        Object.defineProperty(screen, 'width', {
          get: () => 1920,
          enumerable: true
        });
        Object.defineProperty(screen, 'height', {
          get: () => 1080,
          enumerable: true
        });
        Object.defineProperty(screen, 'availWidth', {
          get: () => 1920,
          enumerable: true
        });
        Object.defineProperty(screen, 'availHeight', {
          get: () => 1040,
          enumerable: true
        });
        Object.defineProperty(screen, 'colorDepth', {
          get: () => 24,
          enumerable: true
        });
        Object.defineProperty(screen, 'pixelDepth', {
          get: () => 24,
          enumerable: true
        });

        // Block timezone fingerprinting - return UTC offset
        Date.prototype.getTimezoneOffset = function() {
          return 0;
        };

        // Spoof Intl.DateTimeFormat to UTC
        const OrigDateTimeFormat = Intl.DateTimeFormat;
        Intl.DateTimeFormat = function(...args) {
          const options = args[1] || {};
          options.timeZone = 'UTC';
          return new OrigDateTimeFormat(args[0], options);
        };

        // === FONT FINGERPRINTING PROTECTION ===
        // Limit fonts to standard system fonts only (Safari/Tor approach)
        // This prevents enumeration of installed fonts which reveals unique info
        const ALLOWED_FONTS = [
          'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
          'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana',
          'Helvetica', 'Helvetica Neue', 'Lucida Console', 'Lucida Sans Unicode',
          'Palatino Linotype', 'Tahoma', 'serif', 'sans-serif', 'monospace',
          'cursive', 'fantasy', 'system-ui', '-apple-system', 'BlinkMacSystemFont'
        ];

        // Override document.fonts API
        if (document.fonts) {
          const originalCheck = document.fonts.check.bind(document.fonts);
          document.fonts.check = function(font, text) {
            // Only return true for allowed standard fonts
            const fontFamily = font.split(' ').pop().replace(/['"]/g, '');
            if (ALLOWED_FONTS.some(f => fontFamily.toLowerCase().includes(f.toLowerCase()))) {
              return originalCheck(font, text);
            }
            return false; // Non-standard font - pretend it doesn't exist
          };

          // Block font loading for non-standard fonts
          const originalLoad = document.fonts.load.bind(document.fonts);
          document.fonts.load = function(font, text) {
            const fontFamily = font.split(' ').pop().replace(/['"]/g, '');
            if (ALLOWED_FONTS.some(f => fontFamily.toLowerCase().includes(f.toLowerCase()))) {
              return originalLoad(font, text);
            }
            return Promise.resolve([]); // Non-standard font - return empty
          };

          // Override forEach to only iterate standard fonts
          const originalForEach = document.fonts.forEach.bind(document.fonts);
          document.fonts.forEach = function(callback, thisArg) {
            originalForEach(function(fontFace, index, set) {
              if (ALLOWED_FONTS.some(f => fontFace.family.toLowerCase().includes(f.toLowerCase()))) {
                callback.call(thisArg, fontFace, index, set);
              }
            }, thisArg);
          };

          // Override size to return limited count
          Object.defineProperty(document.fonts, 'size', {
            get: () => ALLOWED_FONTS.length,
            enumerable: true
          });
        }

        console.log('[Privacy] Anti-fingerprinting protections enabled');
      })();
    `, true).catch(() => {});
  })

  return view
}

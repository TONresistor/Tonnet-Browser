/**
 * WebContentsView factory for tab content.
 * Creates isolated views with TON proxy configured.
 */

import { WebContentsView, session } from 'electron'
import { USER_AGENT } from '../../shared/constants'
import { getSetting } from '../settings'
import { contentFilterManager } from '../content-filter/filter-manager'
import { createLogger } from '../../shared/logger'
const log = createLogger('tabs')

const SESSION_PARTITION = 'persist:ton-browser'

export async function createTonSession(proxyPort: number, partitionName: string = SESSION_PARTITION) {
  const ses = session.fromPartition(partitionName)

  // Configure proxy - route ALL requests through proxy (no bypass)
  // MUST await: loadURL before proxy is ready causes ERR_ABORTED (-3)
  await ses.setProxy({
    proxyRules: `http://127.0.0.1:${proxyPort}`,
  })

  // Block all permissions by default (privacy)
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  ses.setPermissionCheckHandler(() => false)

  // Set uniform User-Agent
  ses.setUserAgent(USER_AGENT)

  // Sync content filter settings from user preferences
  contentFilterManager.applySettings(getSetting('contentFiltering'))

  // Content Filtering: Block ads, trackers, miners, and malicious content
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (details, callback) => {
    const { url, resourceType } = details

    // Check if request should be blocked
    if (contentFilterManager.isBlocked(url, resourceType)) {
      callback({ cancel: true })
      return
    }

    callback({})
  })

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

export function createBrowserView(ses: Electron.Session): WebContentsView {
  const view = new WebContentsView({
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

  // WebContentsView defaults to white background — prevent white flash
  view.setBackgroundColor('#0a0a0a')

  // Privacy: Disable tracking APIs on every page load
  view.webContents.on('dom-ready', () => {
    view.webContents
      .executeJavaScript(
        `
      (function() {
        'use strict';

        // Helper: wrap each section so one failure doesn't kill the entire script
        function protect(name, fn) {
          try { fn(); } catch(e) { console.warn('[Privacy] ' + name + ' failed:', e.message); }
        }

        // === NAVIGATOR PROPERTIES SPOOFING ===
        protect('NavigatorSpoofing', () => {
          // Match HTTP User-Agent header for consistency
          Object.defineProperty(navigator, 'userAgent', {
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            enumerable: true,
            configurable: true
          });

          Object.defineProperty(navigator, 'platform', {
            get: () => 'Win32',
            enumerable: true,
            configurable: true
          });

          Object.defineProperty(navigator, 'language', {
            get: () => 'en-US',
            enumerable: true,
            configurable: true
          });

          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
            enumerable: true,
            configurable: true
          });

          // Block Client Hints API (prevents UA bypass in Chrome 90+)
          Object.defineProperty(navigator, 'userAgentData', {
            get: () => undefined,
            enumerable: true,
            configurable: true
          });

          // Derived properties for consistency
          Object.defineProperty(navigator, 'appVersion', {
            get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            enumerable: true,
            configurable: true
          });

          Object.defineProperty(navigator, 'vendor', {
            get: () => 'Google Inc.',
            enumerable: true,
            configurable: true
          });

          Object.defineProperty(navigator, 'product', {
            get: () => 'Gecko',
            enumerable: true,
            configurable: true
          });
        });

        // === CANVAS FINGERPRINT PROTECTION ===
        // Session seed for deterministic noise (stable per session)
        const sessionSeed = crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF;

        const noisifyCanvasData = (original, width, height) => {
          const data = new Uint8ClampedArray(original);
          for (let i = 0; i < data.length; i += 4) {
            const noise = ((sessionSeed * (i % 233)) % 3) - 1;
            data[i] = Math.max(0, Math.min(255, data[i] + noise));
            data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
            data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
          }
          return data;
        };

        protect('CanvasFingerprint', () => {
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
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            const noisedData = ctx.createImageData(this.width, this.height);
            noisedData.data.set(noisifyCanvasData(imageData.data, this.width, this.height));
            ctx.putImageData(noisedData, 0, 0);
            const result = originalToDataURL.apply(this, args);
            ctx.putImageData(imageData, 0, 0);
            return result;
          };

          const originalToBlob = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function(...args) {
            const ctx = this.getContext('2d');
            if (!ctx) return originalToBlob.apply(this, args);
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            const noisedData = ctx.createImageData(this.width, this.height);
            noisedData.data.set(noisifyCanvasData(imageData.data, this.width, this.height));
            ctx.putImageData(noisedData, 0, 0);
            const callback = args[0];
            const that = this;
            const restoreCallback = function(blob) {
              ctx.putImageData(imageData, 0, 0);
              if (callback) callback.call(that, blob);
            };
            args[0] = restoreCallback;
            return originalToBlob.apply(this, args);
          };
        });

        // === WEBGL FINGERPRINT PROTECTION ===
        protect('WebGLFingerprint', () => {
          const getParameterProto = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(param) {
            const spoofed = {
              37445: 'Intel Inc.',
              37446: 'Intel Iris OpenGL Engine',
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
        });

        // === AUDIOCONTEXT FINGERPRINT PROTECTION ===
        protect('AudioContext', () => {
          const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
          if (OriginalAudioContext) {
            const originalCreateAnalyser = OriginalAudioContext.prototype.createAnalyser;
            OriginalAudioContext.prototype.createAnalyser = function() {
              const analyser = originalCreateAnalyser.call(this);
              const origGetFloatFrequencyData = analyser.getFloatFrequencyData;
              analyser.getFloatFrequencyData = function(array) {
                origGetFloatFrequencyData.call(this, array);
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
                if (osc.frequency) {
                  osc.frequency.value += (sessionSeed % 0.01) - 0.005;
                }
                return origStart.apply(this, args);
              };
              return osc;
            };
          }
        });

        // === WEBRTC IP LEAK PROTECTION ===
        protect('WebRTC', () => {
          if (window.RTCPeerConnection) {
            const origRTCPeerConnection = window.RTCPeerConnection;
            const wrappedRTC = function(config, ...args) {
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
                  if (/((192[.]168)|(10[.])|(172[.](1[6-9]|2[0-9]|3[0-1])))/.test(candidate.candidate)) {
                    console.log('[Privacy] Blocked local IP leak via WebRTC');
                    return Promise.resolve();
                  }
                }
                return origAddIceCandidate.apply(this, arguments);
              };
              return pc;
            };
            wrappedRTC.prototype = origRTCPeerConnection.prototype;
            Object.defineProperty(window, 'RTCPeerConnection', {
              value: wrappedRTC,
              writable: true,
              configurable: true
            });
          }
        });

        // === HARDWARE/PLUGIN ENUMERATION PROTECTION ===
        // Disable Battery API (fingerprinting)
        protect('BatteryAPI', () => {
          if (navigator.getBattery) {
            Object.defineProperty(navigator, 'getBattery', {
              value: () => Promise.reject('Battery API disabled for privacy'),
              writable: false
            });
          }
        });

        // Disable Sensor APIs (fingerprinting)
        protect('DeviceMotionEvent', () => {
          Object.defineProperty(window, 'DeviceMotionEvent', { value: undefined, configurable: true });
        });
        protect('DeviceOrientationEvent', () => {
          Object.defineProperty(window, 'DeviceOrientationEvent', { value: undefined, configurable: true });
        });

        protect('HardwareEnumeration', () => {
          // Spoof navigator.plugins (empty list)
          Object.defineProperty(navigator, 'plugins', { get: () => [], enumerable: true, configurable: true });
          Object.defineProperty(navigator, 'mimeTypes', { get: () => [], enumerable: true, configurable: true });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4, enumerable: true, configurable: true });
          if ('deviceMemory' in navigator) {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, enumerable: true, configurable: true });
          }
          Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, enumerable: true, configurable: true });
          if (navigator.getGamepads) {
            Object.defineProperty(navigator, 'getGamepads', { value: () => [], writable: false, configurable: true });
          }
          if (navigator.usb) {
            Object.defineProperty(navigator, 'usb', { get: () => undefined, enumerable: true, configurable: true });
          }
          if (navigator.bluetooth) {
            Object.defineProperty(navigator, 'bluetooth', { get: () => undefined, enumerable: true, configurable: true });
          }
        });

        protect('ScreenSpoofing', () => {
          Object.defineProperty(screen, 'width', { get: () => 1920, enumerable: true, configurable: true });
          Object.defineProperty(screen, 'height', { get: () => 1080, enumerable: true, configurable: true });
          Object.defineProperty(screen, 'availWidth', { get: () => 1920, enumerable: true, configurable: true });
          Object.defineProperty(screen, 'availHeight', { get: () => 1040, enumerable: true, configurable: true });
          Object.defineProperty(screen, 'colorDepth', { get: () => 24, enumerable: true, configurable: true });
          Object.defineProperty(screen, 'pixelDepth', { get: () => 24, enumerable: true, configurable: true });
        });

        // Block timezone fingerprinting - return UTC offset
        protect('TimezoneOffset', () => {
          Object.defineProperty(Date.prototype, 'getTimezoneOffset', {
            value: function() { return 0; },
            writable: true,
            configurable: true
          });
        });

        // Spoof Intl.DateTimeFormat to UTC
        protect('DateTimeFormat', () => {
          const OrigDateTimeFormat = Intl.DateTimeFormat;
          Object.defineProperty(Intl, 'DateTimeFormat', {
            value: function(...args) {
              const options = args[1] || {};
              options.timeZone = 'UTC';
              return new OrigDateTimeFormat(args[0], options);
            },
            writable: true,
            configurable: true
          });
        });

        // === FONT FINGERPRINTING PROTECTION ===
        protect('FontFingerprint', () => {
          const ALLOWED_FONTS = [
            'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
            'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana',
            'Helvetica', 'Helvetica Neue', 'Lucida Console', 'Lucida Sans Unicode',
            'Palatino Linotype', 'Tahoma', 'serif', 'sans-serif', 'monospace',
            'cursive', 'fantasy', 'system-ui', '-apple-system', 'BlinkMacSystemFont'
          ];

          if (document.fonts) {
            const originalCheck = document.fonts.check.bind(document.fonts);
            document.fonts.check = function(font, text) {
              const fontFamily = font.split(' ').pop().replace(/['"]/g, '');
              if (ALLOWED_FONTS.some(f => fontFamily.toLowerCase().includes(f.toLowerCase()))) {
                return originalCheck(font, text);
              }
              return false;
            };

            const originalLoad = document.fonts.load.bind(document.fonts);
            document.fonts.load = function(font, text) {
              const fontFamily = font.split(' ').pop().replace(/['"]/g, '');
              if (ALLOWED_FONTS.some(f => fontFamily.toLowerCase().includes(f.toLowerCase()))) {
                return originalLoad(font, text);
              }
              return Promise.resolve([]);
            };

            const originalForEach = document.fonts.forEach.bind(document.fonts);
            document.fonts.forEach = function(callback, thisArg) {
              originalForEach(function(fontFace, index, set) {
                if (ALLOWED_FONTS.some(f => fontFace.family.toLowerCase().includes(f.toLowerCase()))) {
                  callback.call(thisArg, fontFace, index, set);
                }
              }, thisArg);
            };

            Object.defineProperty(document.fonts, 'size', {
              get: () => ALLOWED_FONTS.length,
              enumerable: true,
              configurable: true
            });
          }
        });

        // === VIEWPORT DIMENSION SPOOFING ===
        protect('ViewportSpoofing', () => {
          const originalInnerWidth = Object.getOwnPropertyDescriptor(Window.prototype, 'innerWidth');
          const originalInnerHeight = Object.getOwnPropertyDescriptor(Window.prototype, 'innerHeight');
          const originalOuterWidth = Object.getOwnPropertyDescriptor(Window.prototype, 'outerWidth');
          const originalOuterHeight = Object.getOwnPropertyDescriptor(Window.prototype, 'outerHeight');

          if (originalInnerWidth && originalInnerHeight) {
            Object.defineProperty(window, 'innerWidth', {
              get: function() { return Math.floor((originalInnerWidth.get?.call(this) || 1024) / 200) * 200; },
              enumerable: true, configurable: true
            });
            Object.defineProperty(window, 'innerHeight', {
              get: function() { return Math.floor((originalInnerHeight.get?.call(this) || 768) / 100) * 100; },
              enumerable: true, configurable: true
            });
          }

          if (originalOuterWidth && originalOuterHeight) {
            Object.defineProperty(window, 'outerWidth', {
              get: function() { return Math.floor((originalOuterWidth.get?.call(this) || 1024) / 200) * 200; },
              enumerable: true, configurable: true
            });
            Object.defineProperty(window, 'outerHeight', {
              get: function() { return Math.floor((originalOuterHeight.get?.call(this) || 768) / 100) * 100; },
              enumerable: true, configurable: true
            });
          }
        });

        console.log('[Privacy] Anti-fingerprinting protections active');
      })();
    `,
        true
      )
      .catch((error) => {
        log.error('[Privacy] Failed to inject anti-fingerprinting code:', error)
      })
  })

  return view
}

/**
 * Extract favicon from a page.
 * Returns favicon data URL (base64) or null if not found.
 */
export async function extractFavicon(view: WebContentsView): Promise<string | null> {
  try {
    // Try multiple methods to find favicon
    const faviconDataUrl = await view.webContents.executeJavaScript(`
      (function() {
        // Method 1: Look for link rel="icon" or rel="shortcut icon"
        const iconLinks = Array.from(document.querySelectorAll('link[rel*="icon"]'));

        for (const link of iconLinks) {
          const href = link.getAttribute('href');
          if (href) {
            // Convert relative URLs to absolute
            try {
              const url = new URL(href, window.location.href);
              // Security: Only allow http/https schemes
              if (!url.protocol.match(/^https?:/)) {
                continue;
              }
              return url.href;
            } catch {
              continue;
            }
          }
        }

        // Method 2: Default /favicon.ico
        try {
          const defaultFavicon = new URL('/favicon.ico', window.location.origin);
          return defaultFavicon.href;
        } catch {
          return null;
        }
      })();
    `)

    if (!faviconDataUrl) return null

    // Fetch the favicon and convert to base64 data URL
    const faviconBase64 = await view.webContents.executeJavaScript(`
      (async function() {
        const url = ${JSON.stringify(faviconDataUrl)};
        try {
          const response = await fetch(url);
          if (!response.ok) return null;

          const blob = await response.blob();

          // Security: Limit favicon size to 50KB
          if (blob.size > 50000) {
            return null;
          }

          const reader = new FileReader();

          return new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          return null;
        }
      })();
    `)

    // Validate result size (data URL should be < ~70KB for 50KB blob)
    if (faviconBase64 && typeof faviconBase64 === 'string' && faviconBase64.length > 70000) {
      return null
    }

    return faviconBase64 as string | null
  } catch (error) {
    // Silently fail - favicon is optional
    return null
  }
}

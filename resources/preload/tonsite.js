// === ANTI-FINGERPRINTING PROTECTIONS ===
// Runs in preload before page content loads
(function() {
  'use strict';

  // === FUNCTION.PROTOTYPE.TOSTRING PATCH ===
  // Track patched functions so they return [native code] when inspected
  const patchedFunctions = new WeakMap();
  const originalToString = Function.prototype.toString;
  Function.prototype.toString = function() {
    const name = patchedFunctions.get(this);
    if (name !== undefined) {
      return 'function ' + name + '() { [native code] }';
    }
    return originalToString.call(this);
  };
  patchedFunctions.set(Function.prototype.toString, 'toString');

  // Helper: wrap each section so one failure doesn't kill the entire script
  function protect(name, fn) {
    try { fn(); } catch(e) { console.warn('[Privacy] ' + name + ' failed:', e.message); }
  }

  // === NAVIGATOR PROPERTIES SPOOFING ===
  protect('NavigatorSpoofing', () => {
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'platform', {
      get: () => 'Win32',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'language', {
      get: () => 'en-US',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'languages', {
      get: () => ['en-US', 'en'],
      enumerable: true,
      configurable: false
    });

    // Block Client Hints API (prevents UA bypass in Chrome 90+)
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => undefined,
      enumerable: true,
      configurable: false
    });

    // Derived properties for consistency
    Object.defineProperty(Navigator.prototype, 'appVersion', {
      get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'vendor', {
      get: () => 'Google Inc.',
      enumerable: true,
      configurable: false
    });

    Object.defineProperty(Navigator.prototype, 'product', {
      get: () => 'Gecko',
      enumerable: true,
      configurable: false
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
    patchedFunctions.set(CanvasRenderingContext2D.prototype.getImageData, 'getImageData');

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
    patchedFunctions.set(HTMLCanvasElement.prototype.toDataURL, 'toDataURL');

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
    patchedFunctions.set(HTMLCanvasElement.prototype.toBlob, 'toBlob');
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
    patchedFunctions.set(WebGLRenderingContext.prototype.getParameter, 'getParameter');

    if (window.WebGL2RenderingContext) {
      const getParameterProto2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        const spoofed = {
          37445: 'Intel Inc.',
          37446: 'Intel Iris OpenGL Engine',
        };
        return spoofed[param] || getParameterProto2.call(this, param);
      };
      patchedFunctions.set(WebGL2RenderingContext.prototype.getParameter, 'getParameter');
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
    patchedFunctions.set(WebGLRenderingContext.prototype.readPixels, 'readPixels');
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
      patchedFunctions.set(OriginalAudioContext.prototype.createAnalyser, 'createAnalyser');

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
      patchedFunctions.set(OriginalAudioContext.prototype.createOscillator, 'createOscillator');
    }
  });

  // === WEBRTC IP LEAK PROTECTION ===
  protect('WebRTC', () => {
    if (window.RTCPeerConnection) {
      const origRTCPeerConnection = window.RTCPeerConnection;

      // Regex patterns for IPv4 and IPv6 addresses
      const ipv4Re = /([0-9]{1,3}\.){3}[0-9]{1,3}/g;
      const ipv6Re = /([a-f0-9]{1,4}:){7}[a-f0-9]{1,4}/gi;

      // Strip IP addresses from an ICE candidate string
      const sanitizeCandidate = (candidate) =>
        candidate.replace(ipv4Re, '0.0.0.0').replace(ipv6Re, '::');

      // Wrap an icecandidate callback to redact IP addresses from candidates
      const wrapIceCandidateListener = (fn, ctx) => {
        return (event) => {
          if (event.candidate && event.candidate.candidate) {
            const modified = new RTCIceCandidate({
              candidate: sanitizeCandidate(event.candidate.candidate),
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            })
            const modifiedEvent = new Event('icecandidate')
            Object.defineProperty(modifiedEvent, 'candidate', { value: modified })
            fn.call(ctx, modifiedEvent)
          } else {
            fn.call(ctx, event)
          }
        }
      }

      // Intercept addEventListener to wrap icecandidate listeners
      const origAddEventListener = RTCPeerConnection.prototype.addEventListener;
      RTCPeerConnection.prototype.addEventListener = function(type, listener, options) {
        if (type === 'icecandidate') {
          return origAddEventListener.call(this, type, wrapIceCandidateListener(listener, this), options)
        }
        return origAddEventListener.call(this, type, listener, options)
      }

      // Intercept onicecandidate property setter
      const origOnIceCandidateDesc = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'onicecandidate');
      if (origOnIceCandidateDesc) {
        Object.defineProperty(RTCPeerConnection.prototype, 'onicecandidate', {
          set(fn) {
            if (typeof fn === 'function') {
              origOnIceCandidateDesc.set.call(this, wrapIceCandidateListener(fn, this))
            } else {
              origOnIceCandidateDesc.set.call(this, fn)
            }
          },
          get() { return origOnIceCandidateDesc.get.call(this) },
          configurable: true,
        })
      }

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

  // === NETWORK INFORMATION API SPOOFING ===
  protect('NetworkInformationAPI', () => {
    if (navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          type: 'unknown',
          downlink: 10,
          rtt: 50,
          saveData: false,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
        configurable: false,
      })
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
    Object.defineProperty(Navigator.prototype, 'plugins', { get: () => [], enumerable: true, configurable: false });
    Object.defineProperty(Navigator.prototype, 'mimeTypes', { get: () => [], enumerable: true, configurable: false });
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4, enumerable: true, configurable: false });
    if ('deviceMemory' in navigator) {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8, enumerable: true, configurable: false });
    }
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 0, enumerable: true, configurable: false });
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
    Object.defineProperty(Screen.prototype, 'width', { get: () => 1920, enumerable: true, configurable: false });
    Object.defineProperty(Screen.prototype, 'height', { get: () => 1080, enumerable: true, configurable: false });
    Object.defineProperty(Screen.prototype, 'availWidth', { get: () => 1920, enumerable: true, configurable: false });
    Object.defineProperty(Screen.prototype, 'availHeight', { get: () => 1040, enumerable: true, configurable: false });
    Object.defineProperty(Screen.prototype, 'colorDepth', { get: () => 24, enumerable: true, configurable: false });
    Object.defineProperty(Screen.prototype, 'pixelDepth', { get: () => 24, enumerable: true, configurable: false });
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
        enumerable: true, configurable: false
      });
      Object.defineProperty(window, 'innerHeight', {
        get: function() { return Math.floor((originalInnerHeight.get?.call(this) || 768) / 100) * 100; },
        enumerable: true, configurable: false
      });
    }

    if (originalOuterWidth && originalOuterHeight) {
      Object.defineProperty(window, 'outerWidth', {
        get: function() { return Math.floor((originalOuterWidth.get?.call(this) || 1024) / 200) * 200; },
        enumerable: true, configurable: false
      });
      Object.defineProperty(window, 'outerHeight', {
        get: function() { return Math.floor((originalOuterHeight.get?.call(this) || 768) / 100) * 100; },
        enumerable: true, configurable: false
      });
    }
  });

  console.log('[Privacy] Anti-fingerprinting protections active');
})();

// === TON BRIDGE API ===
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tonBridge', {
  send: function (data) {
    if (typeof data !== 'string' || data.length > 65536) return
    ipcRenderer.invoke('bridge:send', data)
  },
  onMessage: function (callback) {
    var listener = function (_event, data) { callback(data) }
    ipcRenderer.on('bridge:message', listener)
    return function () { ipcRenderer.removeListener('bridge:message', listener) }
  },
})

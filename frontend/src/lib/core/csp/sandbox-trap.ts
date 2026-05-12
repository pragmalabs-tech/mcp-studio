/**
 * Sandbox-trap script for strict-mode widget iframes.
 *
 * Sandboxed widget iframes should not access storage, geolocation,
 * camera/mic, notifications, service workers, clipboard, credentials,
 * bluetooth, USB, or other device/permission APIs. Neither ChatGPT nor
 * Claude grant these permissions to widgets.
 *
 * Without allow-same-origin (ChatGPT) storage APIs throw SecurityError.
 * Even with allow-same-origin (Claude) these APIs are not intended for
 * widget use - the platforms could revoke access at any time.
 *
 * The trap intercepts access attempts and reports them via postMessage so
 * the studio can surface them in the CSP Check panel, even when the code
 * lives in bundled JS that static analysis cannot inspect.
 */

export function buildSandboxTrap(): string {
  return `<script>
(function() {
  var reported = {};
  function report(label, category, err, severity) {
    var key = label + ':' + (severity || 'error');
    if (reported[key]) return;
    reported[key] = true;
    window.parent.postMessage({
      type: 'studio_sandbox_violation',
      api: label,
      category: category,
      severity: severity || 'error',
      message: err ? err.message : label + ' is not available in widget sandboxed iframe'
    }, '*');
  }

  // --- Storage APIs (SecurityError without allow-same-origin) ---
  var storageProps = [
    { prop: 'localStorage', label: 'localStorage' },
    { prop: 'sessionStorage', label: 'sessionStorage' },
    { prop: 'indexedDB', label: 'indexedDB' },
    { prop: 'caches', label: 'Cache API (caches)' },
  ];
  storageProps.forEach(function(api) {
    try {
      var desc = Object.getOwnPropertyDescriptor(window, api.prop);
      if (desc && desc.get) {
        var origGet = desc.get;
        Object.defineProperty(window, api.prop, {
          get: function() {
            try { var v = origGet.call(this); report(api.label, 'storage', null, 'warning'); return v; }
            catch(e) { report(api.label, 'storage', e, 'error'); throw e; }
          },
          configurable: true
        });
      }
    } catch(e) {}
  });

  // Trap document.cookie
  try {
    var cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
      || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
    if (cookieDesc) {
      var origCGet = cookieDesc.get;
      var origCSet = cookieDesc.set;
      Object.defineProperty(document, 'cookie', {
        get: function() {
          try { var v = origCGet.call(this); report('document.cookie', 'storage', null, 'warning'); return v; }
          catch(e) { report('document.cookie', 'storage', e, 'error'); throw e; }
        },
        set: function(v) {
          try { origCSet.call(this, v); report('document.cookie (set)', 'storage', null, 'error'); }
          catch(e) { report('document.cookie (set)', 'storage', e, 'error'); throw e; }
        },
        configurable: true
      });
    }
  } catch(e) {}

  // --- Navigator APIs (permissions / device access) ---
  // Getter (property read)  -> warning  (code touched it, be aware)
  // Setter / method call    -> error    (this will fail in production)

  function trapMethod(obj, prop, label, category) {
    try {
      if (typeof obj[prop] !== 'function') return;
      var orig = obj[prop].bind(obj);
      obj[prop] = function() {
        report(label, category, null, 'error');
        return orig.apply(null, arguments);
      };
    } catch(e) {}
  }

  function trapNavGetter(prop, label, category) {
    try {
      var desc = Object.getOwnPropertyDescriptor(Navigator.prototype, prop)
        || Object.getOwnPropertyDescriptor(navigator, prop);
      if (!desc) return;
      if (desc.get) {
        var origGet = desc.get;
        Object.defineProperty(navigator, prop, {
          get: function() { report(label, category, null, 'warning'); return origGet.call(this); },
          configurable: true
        });
      } else if (desc.value !== undefined) {
        var origVal = desc.value;
        Object.defineProperty(navigator, prop, {
          get: function() { report(label, category, null, 'warning'); return origVal; },
          configurable: true
        });
      }
    } catch(e) {}
  }

  // Trap getter + all methods on a navigator sub-object.
  // Important: grab the object reference BEFORE installing the getter trap,
  // otherwise our own read triggers the warning.
  function trapSubApi(parentProp, getterLabel, methods, category) {
    try {
      var obj = navigator[parentProp];
      if (obj) {
        methods.forEach(function(m) {
          trapMethod(obj, m.method, m.label, category);
        });
      }
    } catch(e) {}
    trapNavGetter(parentProp, getterLabel, category);
  }

  trapSubApi('geolocation', 'navigator.geolocation', [
    { method: 'getCurrentPosition', label: 'geolocation.getCurrentPosition()' },
    { method: 'watchPosition', label: 'geolocation.watchPosition()' },
  ], 'permission');

  trapSubApi('mediaDevices', 'navigator.mediaDevices', [
    { method: 'getUserMedia', label: 'mediaDevices.getUserMedia()' },
    { method: 'getDisplayMedia', label: 'mediaDevices.getDisplayMedia()' },
    { method: 'enumerateDevices', label: 'mediaDevices.enumerateDevices()' },
  ], 'permission');

  if (typeof Notification !== 'undefined') {
    var OrigNotif = Notification;
    window.Notification = function() {
      report('new Notification()', 'permission', null, 'error');
      return new OrigNotif(arguments[0], arguments[1]);
    };
    window.Notification.prototype = OrigNotif.prototype;
    Object.defineProperty(window.Notification, 'permission', {
      get: function() { report('Notification.permission', 'permission', null, 'warning'); return OrigNotif.permission; }
    });
    window.Notification.requestPermission = function() {
      report('Notification.requestPermission()', 'permission', null, 'error');
      return OrigNotif.requestPermission.apply(OrigNotif, arguments);
    };
  }

  trapSubApi('serviceWorker', 'navigator.serviceWorker', [
    { method: 'register', label: 'serviceWorker.register()' },
    { method: 'getRegistrations', label: 'serviceWorker.getRegistrations()' },
  ], 'worker');

  trapSubApi('clipboard', 'navigator.clipboard', [
    { method: 'readText', label: 'clipboard.readText()' },
    { method: 'writeText', label: 'clipboard.writeText()' },
    { method: 'read', label: 'clipboard.read()' },
    { method: 'write', label: 'clipboard.write()' },
  ], 'permission');

  trapSubApi('credentials', 'navigator.credentials', [
    { method: 'get', label: 'credentials.get()' },
    { method: 'create', label: 'credentials.create()' },
    { method: 'store', label: 'credentials.store()' },
  ], 'permission');

  trapSubApi('bluetooth', 'navigator.bluetooth', [
    { method: 'requestDevice', label: 'bluetooth.requestDevice()' },
    { method: 'getAvailability', label: 'bluetooth.getAvailability()' },
  ], 'device');

  trapSubApi('usb', 'navigator.usb', [
    { method: 'requestDevice', label: 'usb.requestDevice()' },
    { method: 'getDevices', label: 'usb.getDevices()' },
  ], 'device');

  trapSubApi('serial', 'navigator.serial', [
    { method: 'requestPort', label: 'serial.requestPort()' },
    { method: 'getPorts', label: 'serial.getPorts()' },
  ], 'device');

  trapSubApi('hid', 'navigator.hid', [
    { method: 'requestDevice', label: 'hid.requestDevice()' },
    { method: 'getDevices', label: 'hid.getDevices()' },
  ], 'device');

  trapMethod(navigator, 'share', 'navigator.share()', 'permission');
  trapMethod(navigator, 'canShare', 'navigator.canShare()', 'permission');

  if (typeof PaymentRequest !== 'undefined') {
    var OrigPR = PaymentRequest;
    window.PaymentRequest = function() {
      report('new PaymentRequest()', 'permission', null, 'error');
      return new OrigPR(arguments[0], arguments[1], arguments[2]);
    };
    window.PaymentRequest.prototype = OrigPR.prototype;
  }

  var origOpen = window.open;
  window.open = function() {
    report('window.open()', 'navigation', null, 'warning');
    return origOpen.apply(window, arguments);
  };

  try {
    var domainDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'domain');
    if (domainDesc && domainDesc.set) {
      var origDomainGet = domainDesc.get;
      var origDomainSet = domainDesc.set;
      Object.defineProperty(document, 'domain', {
        get: function() { report('document.domain', 'navigation', null, 'warning'); return origDomainGet.call(this); },
        set: function(v) {
          report('document.domain (set)', 'navigation', null, 'error');
          return origDomainSet.call(this, v);
        },
        configurable: true
      });
    }
  } catch(e) {}
})();
</script>`;
}

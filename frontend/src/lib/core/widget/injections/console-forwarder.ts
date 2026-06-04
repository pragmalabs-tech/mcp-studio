import type { Injection } from "./types";

export const consoleForwarderInjection: Injection = {
  id: "console-forwarder",
  name: "Console Forwarder",
  type: "script",
  when: (opts) => !opts.strict,
  build: () => `<script>
(function () {
  var LEVELS = ['log','info','warn','error','debug'];
  function safeStringify(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v instanceof Error) return v.stack || (v.name + ': ' + v.message);
    try {
      var seen = new WeakSet();
      return JSON.stringify(v, function (_k, val) {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        if (typeof val === 'function') return '[Function]';
        if (typeof val === 'bigint') return val.toString() + 'n';
        return val;
      });
    } catch (_e) {
      try { return String(v); } catch (_e2) { return '[Unserializable]'; }
    }
  }
  LEVELS.forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      try {
        var args = Array.prototype.map.call(arguments, safeStringify);
        window.parent.postMessage({ type: 'studio_console', level: level, args: args, time: Date.now() }, '*');
      } catch (_) { /* parent gone or cross-origin */ }
      try { original.apply(console, arguments); } catch (_) { /* ignore */ }
    };
  });
  window.addEventListener('error', function (e) {
    try {
      var msg = e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '');
      window.parent.postMessage({ type: 'studio_console', level: 'error', args: [msg], time: Date.now() }, '*');
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var reason = e.reason;
      var msg = reason && reason.stack ? reason.stack : safeStringify(reason);
      window.parent.postMessage({ type: 'studio_console', level: 'error', args: ['Unhandled rejection: ' + msg], time: Date.now() }, '*');
    } catch (_) {}
  });
})();
</script>`,
};

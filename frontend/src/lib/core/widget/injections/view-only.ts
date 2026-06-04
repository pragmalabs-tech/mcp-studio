import type { Injection } from "./types";

export const viewOnlyInjection: Injection = {
  id: "view-only",
  name: "View-Only Mode",
  type: "script",
  when: (opts) => !!opts.viewOnly,
  build: () => `<script>
(function () {
  var style = document.createElement('style');
  style.textContent = 'html,body{pointer-events:none!important;}body *{user-select:text!important;-webkit-user-select:text!important;cursor:default!important;}';
  (document.head || document.documentElement).appendChild(style);
  var swallow = function (e) { e.stopPropagation(); e.preventDefault(); };
  ['click','dblclick','mousedown','mouseup','keydown','keypress','keyup','submit','change','input','pointerdown','pointerup','touchstart','touchend']
    .forEach(function (t) { window.addEventListener(t, swallow, true); });
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input,select,textarea,button').forEach(function (el) {
      try { el.disabled = true; } catch (_) {}
      el.setAttribute('tabindex', '-1');
    });
  });
})();
</script>`,
};

import type { Injection } from "./types";

export const contentHeightInjection: Injection = {
  id: "content-height",
  name: "Content Height Reporter",
  type: "script",
  when: (opts) => !opts.strict,
  build: () => `<script>
(function () {
  function measure() {
    var max = 0;
    var children = document.body ? document.body.children : [];
    for (var i = 0; i < children.length; i++) {
      var b = children[i].getBoundingClientRect();
      if (b.bottom > max) max = b.bottom;
    }
    if (max > 10) {
      window.parent.postMessage({ type: 'studio_content_height', height: Math.ceil(max) }, '*');
    }
  }

  var pending = false;
  function scheduleMeasure() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; measure(); });
  }

  function observe(ro, el) {
    try { ro.observe(el); } catch (_) {}
  }

  function init() {
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    var ro = new ResizeObserver(scheduleMeasure);
    observe(ro, document.documentElement);
    if (!document.body) return;
    observe(ro, document.body);
    Array.prototype.forEach.call(document.body.children, function (el) { observe(ro, el); });
    new MutationObserver(function () {
      Array.prototype.forEach.call(document.body.children, function (el) { observe(ro, el); });
      scheduleMeasure();
    }).observe(document.body, { childList: true });
  }

  if (document.readyState === 'complete') {
    setTimeout(init, 50);
  } else {
    window.addEventListener('load', function () { setTimeout(init, 50); });
  }
})();
</script>`,
};

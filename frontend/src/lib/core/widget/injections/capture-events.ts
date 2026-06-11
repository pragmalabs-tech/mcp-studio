import type { Injection } from "./types";

export const captureEventsInjection: Injection = {
  id: "capture-events",
  name: "Widget Event Capture",
  type: "script",
  when: (opts) => !opts.strict && !opts.viewOnly,
  build: () => `<script>
(function () {
  var MAX_CANDIDATES = 4;
  var LOOKS_AUTOGEN = /^(css-|_|sc-|ember\d|react-aria-|:r\d+:)/;
  var FORM_TAGS = new Set(['input', 'textarea', 'select']);
  var TESTID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
  var TEXT_INPUT_TYPES = new Set(['text','search','url','email','password','tel','number','date','time','datetime-local','month','week']);

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return value.replace(/(["\\\\])/g, '\\\\$1');
  }

  function isUnique(sel, el, root) {
    try {
      var matches = root.querySelectorAll(sel);
      return matches.length === 1 && matches[0] === el;
    } catch (_) { return false; }
  }

  function stableClasses(el) {
    return Array.from(el.classList).filter(function (c) { return !LOOKS_AUTOGEN.test(c); });
  }

  function structuralPath(el, root) {
    var parts = [];
    var cur = el;
    while (cur && cur !== root.documentElement && cur.parentElement) {
      var parent = cur.parentElement;
      var tag = cur.tagName.toLowerCase();
      var siblings = Array.from(parent.children).filter(function (s) { return s.tagName === cur.tagName; });
      var idx = siblings.indexOf(cur) + 1;
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      cur = parent;
    }
    return parts.join(' > ');
  }

  function formSemantics(el) {
    var tag = el.tagName.toLowerCase();
    if (!FORM_TAGS.has(tag)) return [];
    var results = [];
    var name = el.getAttribute('name');
    var ariaLabel = el.getAttribute('aria-label');
    var placeholder = el.getAttribute('placeholder');
    var type = el.type;
    if (name) results.push(tag + '[name="' + cssEscape(name) + '"]');
    if (ariaLabel) results.push('[aria-label="' + cssEscape(ariaLabel) + '"]');
    if (placeholder) results.push(tag + '[placeholder="' + cssEscape(placeholder) + '"]');
    if (type && type !== 'text' && type !== '') results.push(tag + '[type="' + cssEscape(type) + '"]');
    return results;
  }

  function captureSelector(el, root) {
    var candidates = [];
    for (var i = 0; i < TESTID_ATTRS.length; i++) {
      var v = el.getAttribute(TESTID_ATTRS[i]);
      if (v) candidates.push('[' + TESTID_ATTRS[i] + '="' + cssEscape(v) + '"]');
    }
    if (el.id && !LOOKS_AUTOGEN.test(el.id)) candidates.push('#' + cssEscape(el.id));
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) candidates.push('[aria-label="' + cssEscape(ariaLabel) + '"]');
    var sem = formSemantics(el);
    for (var j = 0; j < sem.length; j++) candidates.push(sem[j]);
    var stable = stableClasses(el);
    if (stable.length) {
      var tagName = el.tagName.toLowerCase();
      candidates.push(tagName + '.' + stable.map(cssEscape).join('.')); // all classes — more likely unique
      candidates.push(tagName + '.' + cssEscape(stable[0]));            // first class — prior behavior
    }
    candidates.push(structuralPath(el, root));
    var unique = candidates.filter(function (sel) { return isUnique(sel, el, root); });
    return unique.slice(0, MAX_CANDIDATES);
  }

  function isTextLike(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') return TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
    return false;
  }

  // Serialize a target element into plain facts the host can reason about.
  // Selector capture must run here — it needs the live element. Everything
  // else (what the interaction *means*) is decided by the host segmenter.
  function describeTarget(el) {
    var textLike = isTextLike(el);
    var target = {
      candidates: captureSelector(el, document),
      tag: el.tagName.toLowerCase(),
      isTextLike: textLike,
    };
    var type = el.getAttribute('type');
    if (type) target.type = type;
    var text = (el.textContent || '').trim().slice(0, 40);
    if (text) target.text = text;
    if (textLike) target.value = el.value;
    return target;
  }

  // Locator for a <canvas>: combined-class selector + index among all canvases.
  function describeCanvas(canvas, rect) {
    var stable = stableClasses(canvas);
    var selector = stable.length ? 'canvas.' + stable.map(cssEscape).join('.') : 'canvas';
    var all = Array.prototype.slice.call(document.querySelectorAll('canvas'));
    return {
      selector: selector,
      index: all.indexOf(canvas),
      total: all.length,
      vw: window.innerWidth,
      vh: window.innerHeight,
      cw: rect.width,
      ch: rect.height,
    };
  }

  // Dumb forwarder: serialize an element interaction and post it. The host
  // decides what it means.
  function sendTarget(kind, el, ts, extra) {
    var desc = describeTarget(el);
    if (!desc.candidates.length) return;
    var msg = { type: 'studio_input', kind: kind, target: desc, ts: ts };
    if (extra) for (var k in extra) msg[k] = extra[k];
    window.parent.postMessage(msg, '*');
  }

  // Canvas interactions carry a coordinate, not a selectable child element.
  function emitCanvas(e, canvas) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    window.parent.postMessage({
      type: 'studio_input',
      kind: 'canvas_click',
      canvas: describeCanvas(canvas, rect),
      nx: (e.clientX - rect.left) / rect.width,
      ny: (e.clientY - rect.top) / rect.height,
      detail: e.detail,
      ts: e.timeStamp,
    }, '*');
  }

  var INTERACTIVE = 'button, a, [role="button"], input, select, textarea, label, [onclick], [tabindex]';

  document.addEventListener('click', function (e) {
    if (!e.isTrusted) return;
    var raw = e.target;
    if (!raw || !raw.tagName) return;
    if (raw.tagName.toLowerCase() === 'canvas') {
      emitCanvas(e, raw);
      return;
    }
    // Anchor to the nearest interactive ancestor so we capture the control,
    // not an inner <span>/<svg> that happened to be under the cursor.
    var el = (raw.closest && raw.closest(INTERACTIVE)) || raw;
    sendTarget('click', el, e.timeStamp, { detail: e.detail });
  }, true);

  document.addEventListener('keyup', function (e) {
    if (!e.isTrusted) return;
    if (!e.target) return;
    sendTarget('keyup', e.target, e.timeStamp, { key: e.key });
  }, true);
})();
</script>`,
};

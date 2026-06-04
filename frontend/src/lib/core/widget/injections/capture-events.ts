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

  function stableClass(el) {
    var list = Array.from(el.classList);
    for (var i = 0; i < list.length; i++) {
      if (!LOOKS_AUTOGEN.test(list[i])) return list[i];
    }
    return null;
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
    var cls = stableClass(el);
    if (cls) candidates.push(el.tagName.toLowerCase() + '.' + cssEscape(cls));
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

  // Dumb forwarder: emit every interaction; the host decides what to do with
  // it. No meaning is assigned here.
  function emit(kind, e, extra) {
    var target = e.target;
    if (!target) return;
    var desc = describeTarget(target);
    if (!desc.candidates.length) return;
    var msg = { type: 'studio_input', kind: kind, target: desc, ts: e.timeStamp };
    if (extra) for (var k in extra) msg[k] = extra[k];
    window.parent.postMessage(msg, '*');
  }

  document.addEventListener('click', function (e) {
    if (!e.isTrusted) return;
    emit('click', e);
  }, true);

  document.addEventListener('keyup', function (e) {
    if (!e.isTrusted) return;
    emit('keyup', e, { key: e.key });
  }, true);
})();
</script>`,
};

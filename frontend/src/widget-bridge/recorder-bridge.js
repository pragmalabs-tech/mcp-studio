/* eslint-disable */
/**
 * MCP Studio recorder bridge — runs inside the widget iframe.
 * Plain JS (no TypeScript) so it can be ?raw-imported and inlined into the
 * iframe srcdoc without a separate compile step. Selector logic is duplicated
 * here intentionally — the host-side TypeScript copy in lib/recorder/selector.ts
 * is the source of truth for shape; behavior must stay in sync.
 *
 * Posts BridgeMessage payloads (kind: "widget.dom.*") to window.parent.
 */
(function install() {
  if (window.__mcprRecorderInstalled) return;
  window.__mcprRecorderInstalled = true;

  var TEXT_BEARING = {
    button: 1,
    a: 1,
    label: 1,
    summary: 1,
    h1: 1,
    h2: 1,
    h3: 1,
    h4: 1,
    h5: 1,
    h6: 1,
  };
  var MAX_TEXT_LEN = 80;

  function attr(el, name) {
    var v = el.getAttribute(name);
    return v == null ? undefined : v;
  }

  function visibleText(el) {
    var raw = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (!raw || raw.length > MAX_TEXT_LEN) return undefined;
    return raw;
  }

  function nthOfType(el) {
    var i = 1;
    var sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === el.tagName) i++;
      sib = sib.previousElementSibling;
    }
    return i;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/(["\\])/g, "\\$1");
  }

  function shortCssPath(el) {
    var segments = [];
    var cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.id) {
        segments.unshift("#" + cssEscape(cur.id));
        return segments.join(" > ");
      }
      var tag = cur.tagName.toLowerCase();
      segments.unshift(tag + ":nth-of-type(" + nthOfType(cur) + ")");
      cur = cur.parentElement;
      if (segments.length > 6) break;
    }
    return segments.length ? segments.join(" > ") : undefined;
  }

  function xpath(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1) {
      parts.unshift(cur.tagName.toLowerCase() + "[" + nthOfType(cur) + "]");
      cur = cur.parentElement;
    }
    return "/" + parts.join("/");
  }

  function buildSelectorChain(target) {
    if (!target || target.nodeType !== 1) return {};
    var out = {};
    var testid = attr(target, "data-testid");
    if (testid) out.testid = testid;
    var ariaLabel = attr(target, "aria-label");
    var role = attr(target, "role");
    if (ariaLabel || role) {
      out.aria = {};
      if (ariaLabel) out.aria.label = ariaLabel;
      if (role) out.aria.role = role;
    }
    var tag = target.tagName.toLowerCase();
    if (TEXT_BEARING[tag]) {
      var text = visibleText(target);
      if (text) out.text = { tag: tag, value: text };
    }
    var css = shortCssPath(target);
    if (css) out.css = css;
    out.xpath = xpath(target);
    return out;
  }

  function digest(root) {
    var html = root.innerHTML;
    return html.length + ":" + html.slice(-32);
  }

  function modBits(e) {
    return (
      (e.shiftKey ? 1 : 0) |
      (e.ctrlKey ? 2 : 0) |
      (e.altKey ? 4 : 0) |
      (e.metaKey ? 8 : 0)
    );
  }

  function valueOf(target) {
    if (!target) return undefined;
    var v = target.value;
    return typeof v === "string" ? v : undefined;
  }

  function post(payload) {
    try {
      payload.__recorder = true;
      window.parent.postMessage(payload, "*");
    } catch (e) {
      /* parent gone */
    }
  }

  function settle(cb) {
    requestAnimationFrame(function () {
      requestAnimationFrame(cb);
    });
  }

  function emit(type, e) {
    var before = digest(document.body);
    var target = e.target;
    if (!target) return;
    var selectors = buildSelectorChain(target);

    if (type === "keydown") {
      // Always emit keydown — user wants every keystroke captured.
      settle(function () {
        var mutated = digest(document.body) !== before;
        post({
          kind: "widget.dom.keydown",
          selectors: selectors,
          key: e.key,
          code: e.code,
          mods: modBits(e),
          mutated: mutated,
        });
      });
      return;
    }

    if (type === "input") {
      var value = valueOf(target) || "";
      var inputType = typeof e.inputType === "string" ? e.inputType : "";
      settle(function () {
        var mutated = digest(document.body) !== before;
        if (!mutated) return;
        post({
          kind: "widget.dom.input",
          selectors: selectors,
          value: value,
          inputType: inputType,
          mutated: mutated,
        });
      });
      return;
    }

    if (type === "change") {
      var cval = valueOf(target) || "";
      settle(function () {
        var mutated = digest(document.body) !== before;
        if (!mutated) return;
        post({
          kind: "widget.dom.change",
          selectors: selectors,
          value: cval,
          mutated: mutated,
        });
      });
      return;
    }

    if (type === "submit") {
      settle(function () {
        var mutated = digest(document.body) !== before;
        post({
          kind: "widget.dom.submit",
          selectors: selectors,
          mutated: mutated,
        });
      });
      return;
    }

    if (type === "click") {
      settle(function () {
        var mutated = digest(document.body) !== before;
        if (!mutated) return;
        post({
          kind: "widget.dom.click",
          selectors: selectors,
          mutated: mutated,
        });
      });
      return;
    }
  }

  var TYPES = ["click", "input", "change", "submit", "keydown"];
  for (var i = 0; i < TYPES.length; i++) {
    (function (t) {
      document.addEventListener(
        t,
        function (ev) {
          emit(t, ev);
        },
        {
          capture: true,
          passive: true,
        },
      );
    })(TYPES[i]);
  }
})();

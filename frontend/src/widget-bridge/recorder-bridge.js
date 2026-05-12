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
  // Debug helper gated on window.__mcprDebug. Off by default so the
  // production console stays clean. Enable per-session in DevTools by
  // setting `window.__mcprDebug = true` in the iframe context (the
  // logs are also piped to the parent window so they show up there).
  function dbg() {
    if (!window.__mcprDebug) return;
    var args = Array.prototype.slice.call(arguments);
    try {
      console.log.apply(console, args);
    } catch (e) {}
    try {
      window.parent.postMessage(
        {
          type: "__mcpr_debug",
          args: args.map(function (a) {
            if (a == null || typeof a !== "object") return a;
            try {
              return JSON.parse(JSON.stringify(a));
            } catch (e) {
              return String(a);
            }
          }),
        },
        "*",
      );
    } catch (e) {}
  }
  window.__mcprDbg = dbg;
  if (window.__mcprRecorderInstalled) {
    dbg("[bridge] already installed");
    return;
  }
  window.__mcprRecorderInstalled = true;
  dbg("[bridge] install", new Date().toISOString());

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

  // Selector for elements where a click is meaningful even when no DOM
  // mutation follows (the click typically dispatches a host postMessage,
  // e.g. window.openai.sendFollowUpMessage). Without this, clicks on
  // "Continue Learning" type buttons would be silently dropped because
  // digest() shows no change.
  var INTERACTIVE_SELECTOR =
    "button, a[href], input, select, textarea, " +
    '[role="button"], [role="link"], [role="checkbox"], ' +
    '[role="radio"], [role="menuitem"], [role="tab"], ' +
    '[tabindex]:not([tabindex="-1"])';

  function isInteractiveTarget(el) {
    if (!el || typeof el.closest !== "function") return false;
    try {
      return !!el.closest(INTERACTIVE_SELECTOR);
    } catch (e) {
      return false;
    }
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
      if (isInteractiveTarget(target)) {
        // Post synchronously so the click is recorded BEFORE any host
        // intent that the click triggers (sendFollowUpMessage, etc.).
        // settle() would wait two RAFs and the intent's postMessage
        // arrives at the host first, inverting trace order.
        post({
          kind: "widget.dom.click",
          selectors: selectors,
          mutated: false,
        });
        return;
      }
      // Non-interactive target: wait to see if the DOM mutated. Drops
      // stray clicks on background that did nothing.
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

  // ── Inbound replay channel + render lifecycle ────────────────────────────

  window.__mcprBridgeErrors = 0;
  window.addEventListener("error", function () {
    window.__mcprBridgeErrors++;
  });

  function findByText(root, tag, value) {
    var list = root.querySelectorAll(tag);
    for (var i = 0; i < list.length; i++) {
      var t = (list[i].textContent || "").trim().replace(/\s+/g, " ");
      if (t === value) return list[i];
    }
    return null;
  }

  function escapeAttr(value) {
    return String(value).replace(/(["\\])/g, "\\$1");
  }

  function resolveWithRetry(chain, timeoutMs, cb) {
    var deadline = Date.now() + timeoutMs;
    function tryOnce() {
      var el = resolveSelectorChain(document, chain);
      if (el) {
        cb(el);
        return;
      }
      if (Date.now() >= deadline) {
        cb(null);
        return;
      }
      // ~16ms (one frame) between attempts; total ~30 attempts in 500ms.
      setTimeout(tryOnce, 16);
    }
    tryOnce();
  }

  function resolveSelectorChain(root, chain) {
    if (!chain) return null;
    if (chain.testid) {
      var el = root.querySelector(
        '[data-testid="' + escapeAttr(chain.testid) + '"]',
      );
      if (el) return el;
    }
    if (chain.aria && chain.aria.label) {
      var sel = chain.aria.role
        ? '[aria-label="' +
          escapeAttr(chain.aria.label) +
          '"][role="' +
          escapeAttr(chain.aria.role) +
          '"]'
        : '[aria-label="' + escapeAttr(chain.aria.label) + '"]';
      var el2 = root.querySelector(sel);
      if (el2) return el2;
    }
    if (chain.text) {
      var el3 = findByText(root, chain.text.tag, chain.text.value);
      if (el3) return el3;
    }
    if (chain.css) {
      try {
        var el4 = root.querySelector(chain.css);
        if (el4) return el4;
      } catch (e) {}
    }
    if (chain.xpath && root.evaluate) {
      try {
        var r = root.evaluate(chain.xpath, root, null, 9, null);
        if (r && r.singleNodeValue && r.singleNodeValue.nodeType === 1) {
          return r.singleNodeValue;
        }
      } catch (e) {}
    }
    return null;
  }

  function dispatchSynthetic(el, action) {
    // The engine sends action.kind unprefixed ("dom.click"); accept both
    // the prefixed and unprefixed form so we match regardless of caller.
    var kind = String(action.kind || "").replace(/^widget\./, "");
    if (kind === "dom.click") {
      // Mirror what `userEvent.click()` (testing-library) does: fire the
      // full pointer + mouse sequence rather than just `click`. Many
      // React/Radix/headless-UI handlers wire up to pointerdown or
      // mousedown rather than click, so a bare click event is missed.
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      var x = rect ? rect.left + rect.width / 2 : 0;
      var y = rect ? rect.top + rect.height / 2 : 0;
      var common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        buttons: 0,
        clientX: x,
        clientY: y,
      };
      function fire(EvCtor, type, init) {
        var e = new EvCtor(type, init);
        try {
          Object.defineProperty(e, "isTrusted", {
            value: true,
            configurable: true,
          });
        } catch (err) {
          /* ignore */
        }
        el.dispatchEvent(e);
        return e;
      }
      var PE = window.PointerEvent || window.MouseEvent;
      fire(PE, "pointerover", Object.assign({ pointerType: "mouse" }, common));
      fire(window.MouseEvent, "mouseover", common);
      fire(
        PE,
        "pointerdown",
        Object.assign({ pointerType: "mouse", buttons: 1 }, common),
      );
      fire(
        window.MouseEvent,
        "mousedown",
        Object.assign({}, common, { buttons: 1 }),
      );
      try {
        if (typeof el.focus === "function") el.focus();
      } catch (e) {
        /* ignore */
      }
      fire(PE, "pointerup", Object.assign({ pointerType: "mouse" }, common));
      fire(window.MouseEvent, "mouseup", common);
      fire(window.MouseEvent, "click", common);
      return;
    }
    if (kind === "dom.input" || kind === "dom.change") {
      try {
        el.focus();
        var setter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(el),
          "value",
        );
        if (setter && setter.set) setter.set.call(el, action.value);
        else el.value = action.value;
      } catch (e) {
        try {
          el.value = action.value;
        } catch (e2) {}
      }
      el.dispatchEvent(
        new Event(kind === "dom.input" ? "input" : "change", {
          bubbles: true,
        }),
      );
      return;
    }
    if (kind === "dom.submit") {
      // Prefer dispatching submit on the form; falls back to the element
      var form = el.tagName === "FORM" ? el : el.closest && el.closest("form");
      if (form) {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      } else {
        el.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      }
      return;
    }
    if (kind === "dom.keydown") {
      var mods = action.mods || 0;
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: action.key,
          code: action.code,
          bubbles: true,
          cancelable: true,
          shiftKey: !!(mods & 1),
          ctrlKey: !!(mods & 2),
          altKey: !!(mods & 4),
          metaKey: !!(mods & 8),
        }),
      );
      return;
    }
  }

  function ack(id, payload) {
    payload.op = "ack";
    payload.id = id;
    post(payload);
  }

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.__recorder !== true) return;

    if (m.op === "dispatch") {
      var dispatchKind = String((m.action && m.action.kind) || "").replace(
        /^widget\./,
        "",
      );
      // Selector resolution retries for 500ms (polls every 16ms). With
      // the postMessage mock-update path + React commit, the target
      // button typically appears within 1-2 frames. 500ms is plenty;
      // longer caps just delay the "selector miss" error when the bug
      // is real.
      resolveWithRetry(m.action && m.action.selectors, 500, function (el) {
        if (!el) {
          window.__mcprDbg(
            "[bridge] selector miss",
            JSON.stringify(m.action.selectors),
          );
          ack(m.id, { ok: false, reason: "selector-miss" });
          return;
        }
        if (dispatchKind === "dom.click") {
          try {
            dispatchSynthetic(el, m.action);
          } catch (err) {
            window.__mcprDbg("[bridge] dispatch threw", String(err));
            ack(m.id, {
              ok: false,
              reason: "dispatch-error: " + (err && err.message),
            });
            return;
          }
          settle(function () {
            ack(m.id, { ok: true, mutated: false });
          });
          return;
        }
        // Non-click dispatches: same code as before, no special debug.
        var before = digest(document.body);
        try {
          dispatchSynthetic(el, m.action);
        } catch (err) {
          ack(m.id, {
            ok: false,
            reason: "dispatch-error: " + (err && err.message),
          });
          return;
        }
        settle(function () {
          ack(m.id, { ok: true, mutated: digest(document.body) !== before });
        });
      });
      return;
    }

    if (m.op === "ping") {
      ack(m.id, { ok: true });
      return;
    }

    if (m.op === "snapshot") {
      try {
        post({
          op: "snapshot.result",
          id: m.id,
          html: document.documentElement
            ? document.documentElement.outerHTML
            : "",
          errors: [],
        });
      } catch (err) {
        post({
          op: "snapshot.result",
          id: m.id,
          html: "",
          errors: [String(err && err.message)],
        });
      }
      return;
    }
  });

  // Emit render.complete after first paint settles. Used by the player to
  // know the iframe is interactive. Handshake flag is set by mock-claude
  // when ui/initialize round-trips.
  var bootStart =
    performance && performance.now ? performance.now() : Date.now();
  window.addEventListener("load", function () {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var nowFn =
          performance && performance.now ? performance.now() : Date.now();
        // `handshakeOk` is host-authoritative now — mock-claude overrides
        // this on the recorder.emit path based on its own ui/initialize
        // observation. The bridge JS reports false; the host fills in
        // the real value before persisting to the bus.
        post({
          op: "render.complete",
          bodyChars: document.body ? document.body.innerHTML.length : 0,
          hasRuntimeErrors: (window.__mcprBridgeErrors || 0) > 0,
          handshakeOk: false,
          renderDurationMs: nowFn - bootStart,
        });
      });
    });
  });
})();

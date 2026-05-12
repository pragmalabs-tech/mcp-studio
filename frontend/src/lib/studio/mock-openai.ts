/**
 * Generates a <script> block that creates a mock `window.openai` object.
 * This is injected into the widget iframe HTML before any widget JS runs.
 *
 * Property access on toolInput/toolOutput sends a detection message to the
 * parent so Studio can tell whether the widget uses the legacy OpenAI API.
 */
export function buildOpenAIMockScript(mock: MockData): string {
  return `<script>
// --- Protocol detection (one-shot per property) ---
var __oaiDetected = {};
function __oaiDetect(api) {
  if (!__oaiDetected[api]) {
    __oaiDetected[api] = true;
    window.parent.postMessage({ type: 'studio_protocol_detect', protocol: 'legacy_openai', api: api }, '*');
  }
}

var __toolInput = ${JSON.stringify(mock.toolInput)};
var __toolOutput = ${JSON.stringify(mock.toolOutput)};
var __widgetState = ${JSON.stringify(mock.widgetState)};

window.openai = {
  get toolInput() { __oaiDetect('toolInput'); return __toolInput; },
  set toolInput(v) { __toolInput = v; },
  get toolOutput() { __oaiDetect('toolOutput'); return __toolOutput; },
  set toolOutput(v) { __toolOutput = v; },
  toolResponseMetadata: ${JSON.stringify(mock._meta)},
  get widgetState() { return __widgetState; },
  set widgetState(v) { __widgetState = v; },
  theme: '${mock.theme}',
  locale: '${mock.locale}',
  displayMode: '${mock.displayMode}',
  maxHeight: window.innerHeight,
  safeArea: { top: 0, bottom: 0, left: 0, right: 0 },

  sendFollowUpMessage: function(opts) {
    __oaiDetect('sendFollowUpMessage');
    window.parent.postMessage({ type: 'studio_action', method: 'sendFollowUpMessage', args: opts }, '*');
    return Promise.resolve();
  },
  callTool: function(name, args) {
    __oaiDetect('callTool');
    var callId = '__studio_call_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    window.parent.postMessage({ type: 'studio_action', method: 'callTool', args: { name: name, arguments: args }, callId: callId }, '*');
    return new Promise(function(resolve) {
      function handler(event) {
        if (event.data && event.data.type === 'studio_tool_result' && event.data.callId === callId) {
          window.removeEventListener('message', handler);
          resolve(event.data.result);
        }
      }
      window.addEventListener('message', handler);
    });
  },
  setWidgetState: function(state) {
    __oaiDetect('setWidgetState');
    window.parent.postMessage({ type: 'studio_action', method: 'setWidgetState', args: state }, '*');
  },
  openExternal: function(opts) {
    window.parent.postMessage({ type: 'studio_action', method: 'openExternal', args: opts }, '*');
    return Promise.resolve();
  },
  notifyIntrinsicHeight: function(h) {
    window.parent.postMessage({ type: 'studio_resize', height: h }, '*');
  },
  requestDisplayMode: function() {
    window.parent.postMessage({ type: 'studio_action', method: 'requestDisplayMode', args: Array.from(arguments) }, '*');
    return Promise.resolve();
  },
  requestClose: function() {
    window.parent.postMessage({ type: 'studio_action', method: 'requestClose', args: {} }, '*');
  },
  requestModal: function(opts) {
    window.parent.postMessage({ type: 'studio_action', method: 'requestModal', args: opts }, '*');
    return Promise.resolve();
  },
  uploadFile: function(file) {
    window.parent.postMessage({ type: 'studio_action', method: 'uploadFile', args: { name: file.name, size: file.size } }, '*');
    return Promise.resolve({ fileId: 'mock-file-' + Date.now() });
  },
  getFileDownloadUrl: function(opts) {
    window.parent.postMessage({ type: 'studio_action', method: 'getFileDownloadUrl', args: opts }, '*');
    return Promise.resolve({ url: 'https://example.com/mock-download' });
  },
  setOpenInAppUrl: function(opts) {
    window.parent.postMessage({ type: 'studio_action', method: 'setOpenInAppUrl', args: opts }, '*');
  }
};

// Inbound update channel: parent posts studio_set_mock to update the
// widget's tool data in place without reloading the iframe. Mutates the
// underlying state and dispatches openai:set_globals so React widgets
// can re-render. This is the canonical update path during both record
// (re-execute) and replay (engine-driven mock changes).
window.addEventListener('message', function(ev) {
  if (!ev.data || ev.data.type !== 'studio_set_mock') return;
  var m = ev.data.mock || {};
  if ('toolInput' in m) __toolInput = m.toolInput;
  if ('toolOutput' in m) __toolOutput = m.toolOutput;
  if ('widgetState' in m) __widgetState = m.widgetState;
  if ('_meta' in m) window.openai.toolResponseMetadata = m._meta;
  window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: m }));
});

// Intercept <a> link clicks and route through openExternal API
document.addEventListener('click', function(e) {
  var target = e.target;
  while (target && target.tagName !== 'A') target = target.parentElement;
  if (target && target.href && target.href !== '#' && !target.href.startsWith('javascript:')) {
    e.preventDefault();
    window.openai.openExternal({ url: target.href });
  }
}, true);
<\/script>`;
}

export interface MockData {
  toolInput: unknown;
  toolOutput: unknown;
  _meta: Record<string, unknown>;
  widgetState: unknown;
  theme: string;
  locale: string;
  displayMode: string;
}

export const DEFAULT_MOCK: MockData = {
  toolInput: {},
  toolOutput: { message: "Replace with your widget's tool output data" },
  _meta: {},
  widgetState: null,
  theme: "dark",
  locale: "en-US",
  displayMode: "compact",
};

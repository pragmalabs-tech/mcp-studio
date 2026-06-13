export const CONFIG = {
  // UI: copy-to-clipboard feedback duration
  TIMEOUT_COPY_FEEDBACK: 1500,

  // UI: tooltip show delay
  TIMEOUT_TOOLTIP: 150,

  // Auth: OAuth expiry countdown refresh interval
  TIMEOUT_OAUTH_EXPIRY_INTERVAL: 1000,

  // Viewport: min/max custom size constraints (px)
  VIEWPORT_MIN_SIZE_PX: 100,
  VIEWPORT_MAX_SIZE_PX: 2560,

  // Widget actions: delay before snapshot after recording a click/text input
  TIMEOUT_WIDGET_SNAPSHOT: 500,

  // Widget actions: max settle window (fallback close) for click/text actions
  TIMEOUT_WIDGET_SETTLE_WINDOW: 5000,

  // Widget actions: brief settle delay after all expected events arrive
  TIMEOUT_WIDGET_EVENT_SETTLE: 150,

  // Widget actions: tool call default snapshot wait
  TIMEOUT_WIDGET_TOOL_CALL: 150,

  // Widget canvas: poll timeout for canvas element to appear in DOM
  TIMEOUT_CANVAS_POLL: 3000,

  // Widget store: deferred apply/load micro-defer
  TIMEOUT_DEFERRED_APPLY: 50,

  // Widget store / runner: wait for widget to render after insert
  TIMEOUT_WIDGET_RENDER: 300,

  // Content height injection: init delay and min reportable height (px)
  TIMEOUT_CONTENT_HEIGHT_INIT: 50,
  CONTENT_HEIGHT_MIN_PX: 10,

  // Replay runner: wait for iframe to match size lock
  TIMEOUT_REPLAY_SIZE_LOCK: 1000,

  // Replay runner: pause between steps for widget to render
  TIMEOUT_RUNNER_STEP: 1000,

  // Assertions: default retry count and inter-attempt delay
  ASSERTION_RETRY_ATTEMPTS: 3,
  ASSERTION_RETRY_DELAY_MS: 50,
} as const;

/**
 * Restricted browser APIs that are blocked or unwanted in widget sandboxes.
 *
 * Static-analysis data for `analyzeHtml` in `csp-checker.ts`. Each entry pairs
 * a regex with the warning copy, severity, and platform applicability used to
 * report the violation.
 */

import type { ViolationPlatform, Severity } from "./csp-checker";

export interface RestrictedApi {
  pattern: RegExp;
  name: string;
  /** Sandbox sub-category. Surfaces as the violation directive in the panel. */
  category: string;
  description: string;
  fix: string;
  platforms: ViolationPlatform[];
  severity: Severity;
}

const both: ViolationPlatform[] = ["ChatGPT", "Claude"];

export const RESTRICTED_APIS: RestrictedApi[] = [
  // Storage APIs (SecurityError without allow-same-origin on ChatGPT; unwanted on both)
  {
    pattern: /\blocalStorage\b/g,
    name: "localStorage",
    category: "sandbox (storage)",
    severity: "warning",
    description: "localStorage is not available in sandboxed widget iframes",
    fix: "Use window.openai.widgetState / setWidgetState() to persist state instead",
    platforms: both,
  },
  {
    pattern: /\bsessionStorage\b/g,
    name: "sessionStorage",
    category: "sandbox (storage)",
    severity: "warning",
    description: "sessionStorage is not available in sandboxed widget iframes",
    fix: "Use component state or widget state API instead",
    platforms: both,
  },
  {
    pattern: /\bindexedDB\b/g,
    name: "indexedDB",
    category: "sandbox (storage)",
    severity: "warning",
    description: "indexedDB is not available in sandboxed widget iframes",
    fix: "Use widget state API or pass data through tool calls instead",
    platforms: both,
  },
  {
    pattern: /\bdocument\.cookie\b/g,
    name: "document.cookie",
    category: "sandbox (storage)",
    severity: "warning",
    description: "document.cookie is not available in sandboxed widget iframes",
    fix: "Cookies are not available — use widget state API instead",
    platforms: both,
  },

  // Geolocation — getter = warning, method call = error
  {
    pattern: /\bnavigator\.geolocation\b(?!\s*[.=])/g,
    name: "navigator.geolocation",
    category: "sandbox (permission)",
    severity: "warning",
    description: "Geolocation API is not available in sandboxed widget iframes",
    fix: "Accessing navigator.geolocation will not work — pass location via tool input if needed",
    platforms: both,
  },
  {
    pattern: /\bgetCurrentPosition\s*\(/g,
    name: "getCurrentPosition()",
    category: "sandbox (permission)",
    severity: "error",
    description: "Geolocation is not available in sandboxed widget iframes",
    fix: "Remove geolocation usage — pass location data through tool input if needed",
    platforms: both,
  },
  {
    pattern: /\bwatchPosition\s*\(/g,
    name: "watchPosition()",
    category: "sandbox (permission)",
    severity: "error",
    description: "Geolocation is not available in sandboxed widget iframes",
    fix: "Remove geolocation usage",
    platforms: both,
  },

  // Camera / Microphone — getter = warning, method call = error
  {
    pattern: /\bnavigator\.mediaDevices\b(?!\s*\.)/g,
    name: "navigator.mediaDevices",
    category: "sandbox (permission)",
    severity: "warning",
    description:
      "MediaDevices API is not available in sandboxed widget iframes",
    fix: "Accessing navigator.mediaDevices will not work — widgets cannot access camera or microphone",
    platforms: both,
  },
  {
    pattern: /\bgetUserMedia\s*\(/g,
    name: "getUserMedia()",
    category: "sandbox (permission)",
    severity: "error",
    description:
      "Camera/microphone access is not available in sandboxed widget iframes",
    fix: "Remove getUserMedia — widgets cannot access camera or microphone",
    platforms: both,
  },
  {
    pattern: /\bgetDisplayMedia\s*\(/g,
    name: "getDisplayMedia()",
    category: "sandbox (permission)",
    severity: "error",
    description: "Screen capture is not available in sandboxed widget iframes",
    fix: "Remove getDisplayMedia — widgets cannot capture screen",
    platforms: both,
  },

  // Notifications — flag constructor calls and requestPermission
  {
    pattern: /\bnew\s+Notification\s*\(/g,
    name: "new Notification()",
    category: "sandbox (permission)",
    severity: "error",
    description:
      "Web Notifications are not available in sandboxed widget iframes",
    fix: "Remove Notification usage — use the widget UI to display messages instead",
    platforms: both,
  },
  {
    pattern: /\bNotification\.requestPermission\s*\(/g,
    name: "Notification.requestPermission()",
    category: "sandbox (permission)",
    severity: "error",
    description:
      "Notification permission requests are blocked in sandboxed iframes",
    fix: "Remove notification permission requests",
    platforms: both,
  },

  // Service Worker — flag register() call, not property read
  {
    pattern: /\.serviceWorker\.register\s*\(/g,
    name: "serviceWorker.register()",
    category: "sandbox (worker)",
    severity: "error",
    description:
      "Service Worker registration is blocked in sandboxed widget iframes",
    fix: "Remove service worker registration — widgets run in a single page context",
    platforms: both,
  },

  // Clipboard — flag actual read/write calls
  {
    pattern: /\.clipboard\.readText\s*\(/g,
    name: "clipboard.readText()",
    category: "sandbox (permission)",
    severity: "warning",
    description:
      "Clipboard read may not be available in sandboxed widget iframes",
    fix: "Wrap clipboard access in try/catch for graceful fallback",
    platforms: both,
  },
  {
    pattern: /\.clipboard\.writeText\s*\(/g,
    name: "clipboard.writeText()",
    category: "sandbox (permission)",
    severity: "warning",
    description:
      "Clipboard write may not be available in sandboxed widget iframes",
    fix: "Use document.execCommand('copy') as fallback, or wrap in try/catch",
    platforms: both,
  },

  // Credentials / WebAuthn — flag method calls
  {
    pattern: /\.credentials\.get\s*\(/g,
    name: "credentials.get()",
    category: "sandbox (permission)",
    severity: "error",
    description:
      "Credential Management API is not available in sandboxed widget iframes",
    fix: "Remove credentials API — authentication should be handled by the host",
    platforms: both,
  },
  {
    pattern: /\.credentials\.create\s*\(/g,
    name: "credentials.create()",
    category: "sandbox (permission)",
    severity: "error",
    description:
      "Credential Management API is not available in sandboxed widget iframes",
    fix: "Remove credentials API — authentication should be handled by the host",
    platforms: both,
  },

  // Device APIs — flag requestDevice/requestPort calls
  {
    pattern: /\.bluetooth\.requestDevice\s*\(/g,
    name: "bluetooth.requestDevice()",
    category: "sandbox (device)",
    severity: "error",
    description: "Web Bluetooth is not available in sandboxed widget iframes",
    fix: "Remove Bluetooth usage — widgets cannot access hardware devices",
    platforms: both,
  },
  {
    pattern: /\.usb\.requestDevice\s*\(/g,
    name: "usb.requestDevice()",
    category: "sandbox (device)",
    severity: "error",
    description: "WebUSB is not available in sandboxed widget iframes",
    fix: "Remove USB usage — widgets cannot access hardware devices",
    platforms: both,
  },
  {
    pattern: /\.serial\.requestPort\s*\(/g,
    name: "serial.requestPort()",
    category: "sandbox (device)",
    severity: "error",
    description: "Web Serial is not available in sandboxed widget iframes",
    fix: "Remove serial port usage — widgets cannot access hardware devices",
    platforms: both,
  },
  {
    pattern: /\.hid\.requestDevice\s*\(/g,
    name: "hid.requestDevice()",
    category: "sandbox (device)",
    severity: "error",
    description: "WebHID is not available in sandboxed widget iframes",
    fix: "Remove HID usage — widgets cannot access hardware devices",
    platforms: both,
  },

  // Payment — flag constructor
  {
    pattern: /\bnew\s+PaymentRequest\s*\(/g,
    name: "new PaymentRequest()",
    category: "sandbox (permission)",
    severity: "error",
    description:
      "Payment Request API is not available in sandboxed widget iframes",
    fix: "Remove PaymentRequest — handle payments server-side through tool calls",
    platforms: both,
  },

  // Web Share — flag method call
  {
    pattern: /\bnavigator\.share\s*\(/g,
    name: "navigator.share()",
    category: "sandbox (permission)",
    severity: "warning",
    description:
      "Web Share API may not be available in sandboxed widget iframes",
    fix: "Remove navigator.share — use openExternal() or widget UI for sharing",
    platforms: both,
  },

  // Navigation — flag setter, not reads
  {
    pattern: /\bdocument\.domain\s*=/g,
    name: "document.domain (set)",
    category: "sandbox (navigation)",
    severity: "error",
    description: "Setting document.domain is blocked in sandboxed iframes",
    fix: "Remove document.domain manipulation — use postMessage for cross-origin communication",
    platforms: both,
  },
];

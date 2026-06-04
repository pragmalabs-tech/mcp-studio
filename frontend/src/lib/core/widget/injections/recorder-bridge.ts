import type { Injection } from "./types";

export const recorderBridgeInjection: Injection = {
  id: "recorder-bridge",
  name: "Recorder Bridge",
  type: "script",
  when: (opts) => !!opts.bridgeSource && !opts.strict,
  build: (opts) => `<script>${opts.bridgeSource}</script>`,
};

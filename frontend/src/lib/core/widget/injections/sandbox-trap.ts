import { buildSandboxTrap } from "@/lib/core/csp/sandbox-trap";
import type { Injection } from "./types";

export const sandboxTrapInjection: Injection = {
  id: "sandbox-trap",
  name: "Sandbox Trap",
  type: "script",
  when: (opts) => opts.strict,
  build: () => buildSandboxTrap(),
};

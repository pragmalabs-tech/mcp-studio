import { buildOpenAIMockScript } from "@/lib/studio/mock-openai";
import type { Injection } from "./types";

export const openaiMockInjection: Injection = {
  id: "openai-mock",
  name: "OpenAI Legacy Mock",
  type: "script",
  when: (opts) => opts.platform === "openai",
  build: (opts) => buildOpenAIMockScript(opts.mock),
};

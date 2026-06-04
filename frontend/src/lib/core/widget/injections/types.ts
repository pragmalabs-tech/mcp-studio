import type { RenderOpts } from "../render-html";

export interface Injection {
  id: string;
  name: string;
  type: "meta" | "script";
  when: (opts: RenderOpts) => boolean;
  build: (opts: RenderOpts) => string;
}

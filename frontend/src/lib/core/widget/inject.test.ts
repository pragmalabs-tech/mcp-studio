import { describe, expect, it } from "vitest";
import { inject, stripTunnelUrls } from "./inject";

const PAGE = `<html><head><title>x</title></head><body><p>ok</p></body></html>`;

describe("inject", () => {
  it("returns html unchanged for empty opts", () => {
    expect(inject(PAGE, {})).toBe(PAGE);
  });

  it("rewrites tunnel URLs before injecting", () => {
    const html = `<html><head></head><body><img src="https://abc123.tunnel.mcpr.app/x.png"></body></html>`;
    const out = inject(html, { rewriteTunnel: "http://localhost:9000" });
    expect(out).toContain("http://localhost:9000/x.png");
    expect(out).not.toContain("tunnel.mcpr.app");
  });

  it("injects a <meta> tag inside <head>", () => {
    const tag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'">`;
    const out = inject(PAGE, { metas: [tag] });
    expect(out).toContain(`<head>${tag}<title>x</title>`);
  });

  it("injects a <script> tag inside <head>", () => {
    const tag = `<script>window.X = 1</script>`;
    const out = inject(PAGE, { scripts: [tag] });
    expect(out).toContain(`<head>${tag}<title>x</title>`);
  });

  it("preserves attributes on the <head> element", () => {
    const html = `<html><head lang="en"><title>x</title></head><body></body></html>`;
    const out = inject(html, { metas: [`<meta charset="utf-8">`] });
    expect(out).toContain(`<head lang="en"><meta charset="utf-8">`);
  });

  it("applies tunnel-rewrite first, then injections", () => {
    const html = `<html><head></head><body><a href="https://abc.tunnel.mcpr.app/p"></a></body></html>`;
    const out = inject(html, {
      rewriteTunnel: "http://local",
      scripts: [`<script>1</script>`],
    });
    expect(out).toContain("http://local/p");
    expect(out).toContain(`<head><script>1</script>`);
  });

  it("applies metas in array order, then scripts in array order", () => {
    const out = inject(PAGE, {
      metas: [`<meta name="a">`, `<meta name="b">`],
      scripts: [`<script>1</script>`, `<script>2</script>`],
    });
    // Items are inserted in natural array order: first item appears first in head.
    const idxA = out.indexOf(`<meta name="a">`);
    const idxB = out.indexOf(`<meta name="b">`);
    const idx1 = out.indexOf(`<script>1</script>`);
    const idx2 = out.indexOf(`<script>2</script>`);
    expect(idxA).toBeLessThan(idxB);
    expect(idx1).toBeLessThan(idx2);
    // Metas are inserted before scripts, so they appear first in head.
    expect(idxA).toBeLessThan(idx1);
  });

  it("leaves the rest of the HTML untouched", () => {
    const out = inject(PAGE, { scripts: [`<script>1</script>`] });
    expect(out).toContain(`<body><p>ok</p></body>`);
  });
});

describe("stripTunnelUrls", () => {
  it("removes tunnel host so paths become relative", () => {
    const html = `<a href="https://xyz.tunnel.mcpr.app/foo">x</a>`;
    expect(stripTunnelUrls(html)).toBe(`<a href="/foo">x</a>`);
  });

  it("leaves non-tunnel URLs alone", () => {
    const html = `<a href="https://example.com/foo">x</a>`;
    expect(stripTunnelUrls(html)).toBe(html);
  });
});

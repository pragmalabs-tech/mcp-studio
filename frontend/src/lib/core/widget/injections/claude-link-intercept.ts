import type { Injection } from "./types";

export const claudeLinkInterceptInjection: Injection = {
  id: "claude-link-intercept",
  name: "Claude Link Interceptor",
  type: "script",
  when: (opts) => opts.platform === "claude",
  build: () => `<script>
document.addEventListener('click', function(e) {
  var target = e.target;
  while (target && target.tagName !== 'A') target = target.parentElement;
  if (target && target.href && target.href !== '#' && !target.href.startsWith('javascript:')) {
    e.preventDefault();
    var id = '__link_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    window.parent.postMessage({ jsonrpc: '2.0', id: id, method: 'ui/open-link', params: { url: target.href } }, '*');
  }
}, true);
</script>`,
};

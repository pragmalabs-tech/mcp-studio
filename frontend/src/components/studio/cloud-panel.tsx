import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Radio,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudioStore } from "@/lib/studio/store";

/**
 * Sidebar panel for cloud-account state: signed-in identity + Publish /
 * tunnel controls. Lifted out of the top header so the toolbar can stay
 * focused on test recording + saved-test access.
 */
export function CloudPanel() {
  const cloudAuth = useStudioStore((s) => s.cloudAuth);
  const tunnel = useStudioStore((s) => s.tunnel);
  const setSignInOpen = useStudioStore((s) => s.setSignInOpen);
  const setPublishOpen = useStudioStore((s) => s.setPublishOpen);
  const cloudSignOut = useStudioStore((s) => s.cloudSignOut);
  const startTunnel = useStudioStore((s) => s.startTunnel);

  // Default closed — most users don't publish on every session, so the
  // sidebar stays focused on tools/resources. Click the header to open.
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    if (!tunnel.url) return;
    await navigator.clipboard.writeText(tunnel.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handlePublishClick() {
    if (cloudAuth) setPublishOpen(true);
    else setSignInOpen(true);
  }

  return (
    <div className="border-b shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-secondary/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          Publish MCP
          {cloudAuth && !open && (
            <span className="text-foreground normal-case font-normal text-[10px] truncate max-w-[140px]">
              {cloudAuth.email}
            </span>
          )}
          {!cloudAuth && !open && (
            <span className="text-muted-foreground normal-case font-normal text-[10px]">
              signed out
            </span>
          )}
        </span>
        <span className="text-[8px]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {cloudAuth ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="w-full inline-flex items-center justify-between gap-1 h-8 px-2.5 rounded-md border bg-muted/30 hover:bg-muted text-xs"
              >
                <span className="truncate">{cloudAuth.email}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute left-0 right-0 mt-1 rounded-md border bg-popover shadow-md z-20 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        cloudSignOut();
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSignInOpen(true)}
              className="w-full"
            >
              Sign in
            </Button>
          )}

          {tunnel.status === "idle" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePublishClick}
              className="w-full"
              title={
                cloudAuth
                  ? "Expose your local MCP server at a public tunnel URL"
                  : "Sign in to publish a tunnel URL"
              }
            >
              <Radio className="h-3.5 w-3.5 mr-1.5" />
              Publish MCP
            </Button>
          )}

          {cloudAuth && tunnel.status === "connecting" && (
            <Button variant="outline" size="sm" disabled className="w-full">
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Starting tunnel...
            </Button>
          )}

          {cloudAuth && tunnel.status === "active" && tunnel.url && (
            <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-md border bg-muted/30 text-xs font-mono">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                aria-label="Tunnel active"
              />
              <a
                href={tunnel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline truncate flex-1"
              >
                {tunnel.url.replace(/^https?:\/\//, "")}
              </a>
              <button
                type="button"
                onClick={copyUrl}
                className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Copy tunnel URL"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setPublishOpen(true)}
                className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Change subdomain"
              >
                <Settings2 className="h-3 w-3" />
              </button>
            </div>
          )}

          {cloudAuth && tunnel.status === "error" && (
            <div className="space-y-1.5">
              <div className="inline-flex items-start gap-1 text-[11px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-words">
                  {tunnel.error || "Tunnel failed"}
                </span>
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => startTunnel(tunnel.subdomain || undefined)}
                >
                  Retry
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setPublishOpen(true)}
                  title="Pick a different subdomain"
                >
                  <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                  Change
                </Button>
              </div>
            </div>
          )}

          {/* Footer hint. Different copy per state so the user knows what
              clicking does next. */}
          <p className="text-[10px] text-muted-foreground/70 italic">
            {!cloudAuth
              ? "Sign in to publish your local MCP server at a tunnel URL anyone can connect to (handy for sharing with teammates or testing in ChatGPT/Claude)."
              : tunnel.status === "active"
                ? "Tunnel forwards traffic from this URL to the active profile's MCP server. Stop it from the Publish dialog (gear icon)."
                : "Publish exposes the active profile's MCP server at a public tunnel URL. Reachable from any MCP host."}
          </p>
        </div>
      )}
    </div>
  );
}

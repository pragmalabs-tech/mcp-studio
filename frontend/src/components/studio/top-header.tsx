import { useState } from "react";
import {
  Radio,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  ChevronDown,
  Settings2,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useStudioStore } from "@/lib/studio/store";
import { isRemoteProxy, getBaseUrl } from "@/lib/studio/api";

export function TopHeader() {
  const cloudAuth = useStudioStore((s) => s.cloudAuth);
  const tunnel = useStudioStore((s) => s.tunnel);
  const setSignInOpen = useStudioStore((s) => s.setSignInOpen);
  const setPublishOpen = useStudioStore((s) => s.setPublishOpen);
  const cloudSignOut = useStudioStore((s) => s.cloudSignOut);
  const startTunnel = useStudioStore((s) => s.startTunnel);
  const proxyUrl = useStudioStore((s) => s.proxyUrl);
  const setProxyUrl = useStudioStore((s) => s.setProxyUrl);

  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(!proxyUrl);
  const [urlDraft, setUrlDraft] = useState(proxyUrl);

  async function copyUrl() {
    if (!tunnel.url) return;
    await navigator.clipboard.writeText(tunnel.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handlePublishClick() {
    if (cloudAuth) {
      setPublishOpen(true);
    } else {
      setSignInOpen(true);
    }
  }

  function openSettings() {
    setUrlDraft(proxyUrl);
    setSettingsOpen(true);
  }

  function handleSaveUrl() {
    const trimmed = urlDraft.trim();
    if (trimmed && trimmed !== proxyUrl) {
      setProxyUrl(trimmed);
    }
    setSettingsOpen(false);
  }

  return (
    <header className="h-12 shrink-0 border-b flex items-center px-3 gap-2">
      {/* Left: logo */}
      <div className="flex items-center gap-2">
        <img
          src="/pragmalabs.png"
          alt="Pragma Labs"
          className="w-6 h-6 rounded"
        />
        <span className="font-semibold text-sm">mcp studio</span>
      </div>

      <div className="flex-1" />

      {/* Right cluster: URL + settings + publish + account */}
      {isRemoteProxy() && (
        <button
          type="button"
          onClick={openSettings}
          className="inline-flex items-center h-8 px-2.5 rounded-md border bg-muted/30 text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Click to change MCP server URL"
        >
          {getBaseUrl()}
        </button>
      )}

      <button
        type="button"
        onClick={openSettings}
        className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        title="Studio settings"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>

      {tunnel.status === "idle" && (
        <Button
          variant="outline"
          size="sm"
          onClick={handlePublishClick}
          title={
            cloudAuth
              ? "Publish your MCP server to a tunnel URL"
              : "Sign in to publish a tunnel URL"
          }
        >
          <Radio className="h-3.5 w-3.5 mr-1.5" />
          Publish
        </Button>
      )}
      {cloudAuth && (
        <>
          {tunnel.status === "connecting" && (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Starting tunnel...
            </Button>
          )}
          {tunnel.status === "active" && tunnel.url && (
            <div className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border bg-muted/30 text-xs font-mono">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-green-500"
                aria-label="Tunnel active"
              />
              <a
                href={tunnel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {tunnel.url.replace(/^https?:\/\//, "")}
              </a>
              <button
                type="button"
                onClick={copyUrl}
                className="ml-1 p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
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
                className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Change subdomain"
              >
                <Settings2 className="h-3 w-3" />
              </button>
            </div>
          )}
          {tunnel.status === "error" && (
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {tunnel.error || "Tunnel failed"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startTunnel(tunnel.subdomain || undefined)}
              >
                Retry
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPublishOpen(true)}
                title="Pick a different subdomain"
              >
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                Change
              </Button>
            </div>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md hover:bg-muted text-xs"
            >
              {cloudAuth.email}
              <ChevronDown className="h-3 w-3" />
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 mt-1 w-44 rounded-md border bg-popover shadow-md z-20 py-1">
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
        </>
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Studio Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                MCP Server URL
              </label>
              <Input
                type="url"
                placeholder="http://localhost:9000"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveUrl();
                }}
                autoFocus
                className="h-9 font-mono text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                The URL of your MCP server. Changing this will reconnect and
                reload all tools and resources.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveUrl}
              disabled={!urlDraft.trim()}
            >
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

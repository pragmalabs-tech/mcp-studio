import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStudioStore } from "@/lib/studio/store";
import {
  fetchTunnelEndpoints,
  type TunnelEndpoint,
} from "@/lib/studio/cloud-api";

export function PublishDialog() {
  const open = useStudioStore((s) => s.publishOpen);
  const setOpen = useStudioStore((s) => s.setPublishOpen);
  const startTunnel = useStudioStore((s) => s.startTunnel);
  const tunnel = useStudioStore((s) => s.tunnel);
  const proxyUrl = useStudioStore((s) => s.proxyUrl);

  const [subdomain, setSubdomain] = useState("");
  const [endpoints, setEndpoints] = useState<TunnelEndpoint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubdomain(tunnel.subdomain ?? "");
    setLoadError(null);
    setEndpoints(null);
    fetchTunnelEndpoints()
      .then(setEndpoints)
      .catch((e) => setLoadError((e as Error).message));
  }, [open, tunnel.subdomain]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await startTunnel(subdomain.trim() || undefined);
  }

  const busy = tunnel.status === "connecting";
  const isActive = tunnel.status === "active";
  const isChanging = isActive || tunnel.status === "error";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isChanging ? "Change subdomain" : "Publish to a tunnel URL"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Exposes your local MCP server on a public{" "}
          <span className="font-mono text-foreground">https://</span> URL so
          Claude, ChatGPT, or any other MCP client can connect to it. The tunnel
          forwards requests to the MCP URL set in Studio settings.
        </p>
        <form onSubmit={submit} className="space-y-4 py-2">
          {endpoints && endpoints.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Your subdomains</Label>
              <div className="flex flex-wrap gap-1.5">
                {endpoints.map((ep) => {
                  const selected = subdomain === ep.name;
                  return (
                    <button
                      key={ep.id}
                      type="button"
                      onClick={() => setSubdomain(ep.name)}
                      className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-mono border transition-colors ${
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-white/10 text-muted-foreground hover:text-foreground hover:border-white/30"
                      }`}
                    >
                      {ep.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="publish-subdomain">
              {endpoints && endpoints.length > 0
                ? "Or use a custom subdomain"
                : "Subdomain (optional)"}
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="publish-subdomain"
                placeholder="my-server"
                value={subdomain}
                onChange={(e) =>
                  setSubdomain(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  )
                }
                autoFocus
              />
              <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                .tunnel.mcpr.app
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave blank for a random subdomain. Forwards to{" "}
              <code className="font-mono text-foreground">
                {proxyUrl || "(set MCP server URL first)"}
              </code>
              .
            </p>
          </div>

          {loadError && (
            <p className="text-xs text-muted-foreground">
              Could not load your subdomains: {loadError}
            </p>
          )}

          {tunnel.status === "error" && tunnel.error && (
            <p className="text-xs text-destructive">{tunnel.error}</p>
          )}

          {isActive && (
            <p className="text-xs text-yellow-500">
              A tunnel is already running. Restart Studio to switch subdomain
              (stop is not yet supported).
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy || !proxyUrl || isActive}
            >
              {busy
                ? "Starting..."
                : isChanging
                  ? "Switch & start"
                  : "Start tunnel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

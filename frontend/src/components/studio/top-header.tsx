import { useEffect, useState } from "react";
import {
  Radio,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  ChevronDown,
  Settings2,
  Clock,
  FlaskConical,
  History,
  Circle,
  Square,
} from "lucide-react";
import { RecordingHistoryDialog } from "@/components/studio/recording-history-dialog";
import { TestsPage } from "@/components/studio/tests-page";
import { ReportsPage } from "@/components/studio/reports-page";
import { SaveTestModal } from "@/components/studio/save-test-modal";
import { ProfilesDialog } from "@/components/studio/profiles-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStudioStore } from "@/lib/studio/store";
import { Separator } from "@/components/ui/separator";
import { recorder } from "@/lib/recorder/bus";

export function TopHeader() {
  const cloudAuth = useStudioStore((s) => s.cloudAuth);
  const tunnel = useStudioStore((s) => s.tunnel);
  const setSignInOpen = useStudioStore((s) => s.setSignInOpen);
  const setPublishOpen = useStudioStore((s) => s.setPublishOpen);
  const cloudSignOut = useStudioStore((s) => s.cloudSignOut);
  const startTunnel = useStudioStore((s) => s.startTunnel);
  const proxyUrl = useStudioStore((s) => s.proxyUrl);
  const profiles = useStudioStore((s) => s.profiles);
  const activeProfileId = useStudioStore((s) => s.activeProfileId);
  const mcpError = useStudioStore((s) => s.mcpError);
  const slicingState = useStudioStore((s) => s.slicingState);
  const setSlicingState = useStudioStore((s) => s.setSlicingState);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || null;

  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  // First-run prompt: once profiles have loaded, if there's still no URL
  // configured, open the manager so the user can pick or create one.
  useEffect(() => {
    if (!proxyUrl && profiles.length > 0) {
      setProfilesOpen(true);
    }
    // Only on the initial transition from "no profiles loaded yet" — runs
    // once when profiles hydrate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length === 0]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [testsOpen, setTestsOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [recordExplainerOpen, setRecordExplainerOpen] = useState(false);
  const [saveTestOpen, setSaveTestOpen] = useState(false);
  const [saveRange, setSaveRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

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

  function openProfiles() {
    setProfilesOpen(true);
  }

  function handleStartRecording() {
    // Always show the explainer — the description has real content (file
    // location, replay modes, redaction note) and recording is intentional
    // enough to warrant a confirmation step.
    setRecordExplainerOpen(true);
  }

  function beginSlice() {
    setSlicingState({
      startIndex: recorder.markIndex(),
      startedAt: new Date().toISOString(),
    });
    setRecordExplainerOpen(false);
  }

  function handleStopRecording() {
    if (!slicingState) return;
    setSaveRange({ start: slicingState.startIndex, end: recorder.markIndex() });
    setSaveTestOpen(true);
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

      {/* Connection cluster: profile name + URL */}
      <button
        type="button"
        onClick={openProfiles}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border bg-muted/30 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Switch profile or edit server URL"
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            mcpError
              ? "bg-red-500"
              : proxyUrl
                ? "bg-green-500"
                : "bg-muted-foreground/40"
          }`}
          aria-label={mcpError ? "Connection error" : "Connected"}
        />
        {activeProfile ? (
          <>
            <span className="font-medium text-foreground">
              {activeProfile.name}
            </span>
            {proxyUrl && (
              <span className="font-mono">
                {proxyUrl.replace(/^https?:\/\//, "")}
              </span>
            )}
          </>
        ) : proxyUrl ? (
          <span className="font-mono">
            {proxyUrl.replace(/^https?:\/\//, "")}
          </span>
        ) : (
          <span>No server</span>
        )}
      </button>

      <Separator orientation="vertical" className="h-5 mx-0.5" />

      {!slicingState ? (
        <Button
          variant="outline"
          size="sm"
          onClick={handleStartRecording}
          title="Start a named test by recording the next series of actions"
        >
          <Circle className="h-3.5 w-3.5 mr-1.5" />
          Record Test
        </Button>
      ) : (
        <Button
          variant="destructive"
          size="sm"
          onClick={handleStopRecording}
          title="Stop and save the recorded actions as a test"
        >
          <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
          Stop Record Test
        </Button>
      )}

      <Separator orientation="vertical" className="h-5 mx-0.5" />

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

      <Separator orientation="vertical" className="h-5 mx-0.5" />

      <button
        type="button"
        onClick={() => setTestsOpen(true)}
        title="Saved tests"
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <FlaskConical className="h-4 w-4" />
        Tests
      </button>

      <button
        type="button"
        onClick={() => setReportsOpen(true)}
        title="Past test runs and reports"
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <History className="h-4 w-4" />
        Reports
      </button>

      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        title="View recorded actions"
        className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <Clock className="h-4 w-4" />
      </button>

      <RecordingHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />

      <TestsPage open={testsOpen} onOpenChange={setTestsOpen} />
      <ReportsPage open={reportsOpen} onOpenChange={setReportsOpen} />

      <Dialog open={recordExplainerOpen} onOpenChange={setRecordExplainerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Circle className="h-4 w-4" />
              Record a test
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm text-muted-foreground">
            <p>
              Studio captures every interaction in the background — tool calls,
              widget renders, clicks and inputs inside widgets.
              <span className="text-foreground font-medium"> Record Test </span>
              marks the start of a slice. Drive Studio through the flow you want
              to test, then press
              <span className="text-foreground font-medium">
                {" "}
                Stop Record Test{" "}
              </span>
              to name and save it as a JSON file in
              <span className="font-mono text-foreground">
                {" "}
                ~/.mcp-studio/tests/
              </span>
              .
            </p>
            <p>
              Saved tests live in the
              <span className="text-foreground font-medium"> Tests </span>
              drawer (flask icon, top right). From there you can
              <span className="text-foreground font-medium"> Run </span>
              one back end-to-end, or
              <span className="text-foreground font-medium"> Step </span>
              through it action-by-action like a debugger. The result modal
              shows a per-step pass/fail timeline with a sandboxed preview of
              every widget render.
            </p>
            <p className="text-xs italic">
              Auth tokens are redacted on save — Studio uses your live token
              when replaying.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRecordExplainerOpen(false)}
            >
              Not now
            </Button>
            <Button size="sm" onClick={beginSlice}>
              Start recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {saveRange && (
        <SaveTestModal
          open={saveTestOpen}
          startIndex={saveRange.start}
          endIndex={saveRange.end}
          onOpenChange={(v) => {
            setSaveTestOpen(v);
            if (!v) {
              setSaveRange(null);
              setSlicingState(null);
            }
          }}
          onSaved={() => {
            setSaveTestOpen(false);
            setSaveRange(null);
            setSlicingState(null);
          }}
        />
      )}

      <ProfilesDialog open={profilesOpen} onOpenChange={setProfilesOpen} />
    </header>
  );
}

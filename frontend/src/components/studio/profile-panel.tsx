import { useEffect, useState } from "react";
import { ChevronsUpDown, Pencil, Plus } from "lucide-react";
import { ProfilesDialog } from "@/components/studio/profiles-dialog";
import { useProfileStore } from "@/lib/studio/stores/profile-store";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";

/**
 * Sidebar panel for the active MCP profile (server URL + name). Click to
 * switch profiles or edit the active one. Auto-opens the manager on first
 * run when no profile URL is set so the user has a target before doing
 * anything else.
 */
export function ProfilePanel() {
  const proxyUrl = useProfileStore((s) => s.proxyUrl);
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const mcpError = useWidgetStore((s) => s.mcpError);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || null;

  const [open, setOpen] = useState(true);
  const [profilesOpen, setProfilesOpen] = useState(false);

  // First-run nudge: once profiles have loaded, pop the manager open if
  //   - there's no URL set (nothing to talk to yet), or
  //   - only the seeded `default` profile exists — the URL is a placeholder
  //     pointing at the Excalidraw demo server, and we want the user to
  //     notice they should set their own MCP target instead of silently
  //     running against the demo.
  useEffect(() => {
    const onlyDefault = profiles.length === 1;
    if (profiles.length > 0 && (!proxyUrl || onlyDefault)) {
      setProfilesOpen(true);
    }
    // Only on the initial transition from "no profiles loaded yet" — runs
    // once when profiles hydrate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length === 0]);

  const dotColor = mcpError
    ? "bg-red-500"
    : proxyUrl
      ? "bg-green-500"
      : "bg-muted-foreground/40";

  return (
    <div className="border-b shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-secondary/50 transition-colors"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          Profile
          {!open && (
            <>
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}
                aria-label={mcpError ? "Connection error" : "Connected"}
              />
              <span className="text-foreground normal-case font-normal text-[10px] truncate">
                {activeProfile?.name ??
                  (proxyUrl ? "(no profile)" : "no server")}
              </span>
            </>
          )}
        </span>
        <span className="text-[8px]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Active-profile picker. Chevrons hint at "switch", the row is
              the dropdown trigger. Pencil button on the right opens the
              same dialog scrolled to edit the active entry. */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setProfilesOpen(true)}
              className="flex-1 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border bg-muted/30 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-0"
              title="Switch active profile"
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}
                aria-label={mcpError ? "Connection error" : "Connected"}
              />
              {activeProfile ? (
                <span className="font-medium text-foreground truncate flex-1 text-left">
                  {activeProfile.name}
                </span>
              ) : (
                <span className="flex-1 text-left">No profile</span>
              )}
              <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            </button>
            <button
              type="button"
              onClick={() => setProfilesOpen(true)}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Edit profile (URL, auth, name)"
              aria-label="Edit profile"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>

          {/* MCP server URL — the most-asked "what am I talking to?" check.
              Click jumps to the same dialog where it can be edited. */}
          {proxyUrl ? (
            <button
              type="button"
              onClick={() => setProfilesOpen(true)}
              className="w-full text-left text-[10px] font-mono text-muted-foreground hover:text-foreground truncate transition-colors"
              title={`MCP URL: ${proxyUrl} (click to edit)`}
            >
              <span className="text-muted-foreground/60 mr-1">URL</span>
              {proxyUrl.replace(/^https?:\/\//, "")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setProfilesOpen(true)}
              className="w-full inline-flex items-center justify-center gap-1 h-7 px-2 rounded-md border border-dashed text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Set MCP server URL
            </button>
          )}

          <p className="text-[10px] text-muted-foreground/70 italic">
            Profiles store the MCP server URL plus per-profile auth. Switching
            here re-routes every test and tool call.
          </p>
        </div>
      )}

      <ProfilesDialog open={profilesOpen} onOpenChange={setProfilesOpen} />
    </div>
  );
}

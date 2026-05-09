import { useEffect, useState } from "react";
import { Check, Plus, Pencil, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useStudioStore } from "@/lib/studio/store";
import {
  createProfile,
  deleteProfile,
  updateProfile,
  type Profile,
} from "@/lib/studio/profiles-api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfilesDialog({ open, onOpenChange }: Props) {
  const profiles = useStudioStore((s) => s.profiles);
  const activeProfileId = useStudioStore((s) => s.activeProfileId);
  const refreshProfiles = useStudioStore((s) => s.refreshProfiles);
  const activateAndApply = useStudioStore((s) => s.activateAndApply);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEditingId(null);
      setAdding(false);
      setError(null);
    }
  }, [open]);

  function startEdit(p: Profile) {
    setEditingId(p.id);
    setDraftName(p.name);
    setDraftUrl(p.server_url);
    setAdding(false);
    setError(null);
  }

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setDraftName("");
    setDraftUrl("");
    setError(null);
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    if (!draftName.trim()) {
      setError("Name is required");
      return;
    }
    try {
      await updateProfile(editingId, {
        name: draftName.trim(),
        server_url: draftUrl.trim(),
      });
      await refreshProfiles();
      setEditingId(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleSaveNew() {
    if (!draftName.trim()) {
      setError("Name is required");
      return;
    }
    try {
      await createProfile({
        name: draftName.trim(),
        server_url: draftUrl.trim(),
      });
      await refreshProfiles();
      setAdding(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteProfile(id);
      await refreshProfiles();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleActivate(id: string) {
    try {
      await activateAndApply(id);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Profiles</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <p className="text-[11px] text-muted-foreground">
            Saved MCP server targets. Replays run against the active profile, so
            updating a profile's URL reroutes its tests.
          </p>
          <div className="rounded-md border divide-y">
            {profiles.map((p) => {
              const isActive = p.id === activeProfileId;
              const isEditing = editingId === p.id;
              return (
                <div key={p.id} className="p-2.5 text-sm">
                  {isEditing ? (
                    <div className="space-y-2">
                      <Input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        placeholder="Name"
                        className="h-8"
                      />
                      <Input
                        value={draftUrl}
                        onChange={(e) => setDraftUrl(e.target.value)}
                        placeholder="http://localhost:9000"
                        className="h-8 font-mono text-xs"
                      />
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handleSaveEdit}>
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleActivate(p.id)}
                        className="flex-1 text-left flex items-center gap-2 hover:bg-muted/40 -mx-1 px-1 py-0.5 rounded"
                        title={
                          isActive ? "Active profile" : "Switch to this profile"
                        }
                      >
                        <span
                          className={`inline-flex items-center justify-center w-4 h-4 rounded-full border ${
                            isActive
                              ? "bg-green-500 border-green-500 text-white"
                              : "border-muted-foreground/30"
                          }`}
                        >
                          {isActive && <Check className="h-3 w-3" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{p.name}</div>
                          <div className="text-[10px] font-mono text-muted-foreground truncate">
                            {p.server_url || "(no URL set)"}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="Edit profile"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        disabled={profiles.length <= 1}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
                        title={
                          profiles.length <= 1
                            ? "Cannot delete the last profile"
                            : "Delete profile"
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {adding && (
              <div className="p-2.5 space-y-2 bg-muted/30">
                <Input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Profile name"
                  className="h-8"
                />
                <Input
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="http://localhost:9000"
                  className="h-8 font-mono text-xs"
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAdding(false)}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveNew}>
                    Add
                  </Button>
                </div>
              </div>
            )}
          </div>
          {!adding && (
            <Button
              variant="outline"
              size="sm"
              onClick={startAdd}
              className="w-full"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add profile
            </Button>
          )}
          {error && (
            <p className="text-xs text-destructive font-mono">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

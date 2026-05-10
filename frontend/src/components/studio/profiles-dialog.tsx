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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useStudioStore } from "@/lib/studio/store";
import {
  createProfile,
  deleteProfile,
  updateProfile,
  type Profile,
  type ProfileAuth,
} from "@/lib/studio/profiles-api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AuthMethod = ProfileAuth["method"];

const METHODS: { value: AuthMethod; label: string }[] = [
  { value: "oauth", label: "OAuth" },
  { value: "bearer", label: "Bearer" },
  { value: "custom", label: "Headers" },
  { value: "none", label: "None" },
];

function authBadgeLabel(auth: Profile["auth"]): string {
  if (!auth || auth.method === "none") return "no auth";
  return auth.method;
}

/**
 * Build a `ProfileAuth` from current draft state. Returns `null` (and the
 * caller surfaces an error) when the chosen method has invalid input
 * (empty bearer token, malformed custom-headers JSON).
 */
function buildAuth(
  method: AuthMethod,
  bearerDraft: string,
  headersDraft: string,
): { auth: ProfileAuth | null; error: string | null } {
  if (method === "none") return { auth: { method: "none" }, error: null };
  if (method === "oauth") return { auth: { method: "oauth" }, error: null };
  if (method === "bearer") {
    return {
      auth: { method: "bearer", token: bearerDraft.trim() },
      error: null,
    };
  }
  // custom
  const raw = headersDraft.trim();
  if (!raw) return { auth: { method: "custom", headers: {} }, error: null };
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { auth: null, error: "Custom headers must be a JSON object" };
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== "string") {
        return { auth: null, error: `Header "${k}" must be a string` };
      }
      headers[k] = v;
    }
    return { auth: { method: "custom", headers }, error: null };
  } catch (e) {
    return { auth: null, error: (e as Error).message };
  }
}

function AuthFields({
  method,
  setMethod,
  bearer,
  setBearer,
  headers,
  setHeaders,
}: {
  method: AuthMethod;
  setMethod: (m: AuthMethod) => void;
  bearer: string;
  setBearer: (v: string) => void;
  headers: string;
  setHeaders: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-md bg-muted/40 p-0.5">
        {METHODS.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMethod(m.value)}
            className={`flex-1 text-[11px] font-medium py-1 rounded ${
              method === m.value
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {method === "bearer" && (
        <Input
          type="password"
          value={bearer}
          onChange={(e) => setBearer(e.target.value)}
          placeholder="Bearer token"
          className="h-8 font-mono text-xs"
        />
      )}
      {method === "custom" && (
        <Textarea
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
          placeholder={`{\n  "X-Admin-Token": "abc"\n}`}
          rows={4}
          spellCheck={false}
          className="text-xs font-mono"
        />
      )}
      {method === "oauth" && (
        <p className="text-[10px] text-muted-foreground">
          OAuth tokens stay in browser storage keyed by origin. Activate this
          profile and sign in via the auth panel.
        </p>
      )}
      {method === "none" && (
        <p className="text-[10px] text-muted-foreground">
          Requests go out unauthenticated. Replays will fail if the server
          requires auth.
        </p>
      )}
    </div>
  );
}

export function ProfilesDialog({ open, onOpenChange }: Props) {
  const profiles = useStudioStore((s) => s.profiles);
  const activeProfileId = useStudioStore((s) => s.activeProfileId);
  const refreshProfiles = useStudioStore((s) => s.refreshProfiles);
  const activateAndApply = useStudioStore((s) => s.activateAndApply);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftMethod, setDraftMethod] = useState<AuthMethod>("none");
  const [draftBearer, setDraftBearer] = useState("");
  const [draftHeaders, setDraftHeaders] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEditingId(null);
      setAdding(false);
      setError(null);
    }
  }, [open]);

  function seedDraftFromProfile(p: Profile) {
    setDraftName(p.name);
    setDraftUrl(p.server_url);
    const auth = p.auth ?? { method: "none" };
    setDraftMethod(auth.method);
    setDraftBearer(auth.method === "bearer" ? auth.token : "");
    setDraftHeaders(
      auth.method === "custom" ? JSON.stringify(auth.headers, null, 2) : "",
    );
  }

  function startEdit(p: Profile) {
    setEditingId(p.id);
    seedDraftFromProfile(p);
    setAdding(false);
    setError(null);
  }

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setDraftName("");
    setDraftUrl("");
    setDraftMethod("none");
    setDraftBearer("");
    setDraftHeaders("");
    setError(null);
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    if (!draftName.trim()) {
      setError("Name is required");
      return;
    }
    const { auth, error: authError } = buildAuth(
      draftMethod,
      draftBearer,
      draftHeaders,
    );
    if (authError || !auth) {
      setError(authError || "Invalid auth");
      return;
    }
    try {
      await updateProfile(editingId, {
        name: draftName.trim(),
        server_url: draftUrl.trim(),
        auth,
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
    const { auth, error: authError } = buildAuth(
      draftMethod,
      draftBearer,
      draftHeaders,
    );
    if (authError || !auth) {
      setError(authError || "Invalid auth");
      return;
    }
    try {
      await createProfile({
        name: draftName.trim(),
        server_url: draftUrl.trim(),
        auth,
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
            Saved MCP server targets with auth. Replays use the active profile's
            URL and credentials, so updating a profile reroutes its tests.
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
                      <AuthFields
                        method={draftMethod}
                        setMethod={setDraftMethod}
                        bearer={draftBearer}
                        setBearer={setDraftBearer}
                        headers={draftHeaders}
                        setHeaders={setDraftHeaders}
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
                          <div className="font-medium truncate flex items-center gap-1.5">
                            {p.name}
                            <span className="text-[9px] uppercase tracking-wide rounded bg-muted px-1 py-px text-muted-foreground">
                              {authBadgeLabel(p.auth)}
                            </span>
                          </div>
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
                <AuthFields
                  method={draftMethod}
                  setMethod={setDraftMethod}
                  bearer={draftBearer}
                  setBearer={setDraftBearer}
                  headers={draftHeaders}
                  setHeaders={setDraftHeaders}
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

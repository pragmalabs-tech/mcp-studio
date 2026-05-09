import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { recorder } from "@/lib/recorder/bus";
import { newTest, slugify } from "@/lib/tests/format";
import { saveTest } from "@/lib/tests/api";

interface Props {
  open: boolean;
  startIndex: number;
  endIndex: number;
  onOpenChange: (open: boolean) => void;
  onSaved: (slug: string) => void;
}

export function SaveTestModal({
  open,
  startIndex,
  endIndex,
  onOpenChange,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  const slug = slugify(name);
  const count = Math.max(0, endIndex - startIndex);
  const preview = recorder
    .snapshot()
    .slice(startIndex, endIndex)
    .slice(0, 3)
    .map((e) => e.kind)
    .join(", ");

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const session = recorder.serializeRange(startIndex, endIndex);
      const test = newTest({
        name: name.trim(),
        description: description.trim() || undefined,
        session,
      });
      await saveTest(slug, test);
      onSaved(slug);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save test</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Name
            </Label>
            <Input
              autoFocus
              placeholder="e.g. Search flow"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              className="h-9"
            />
            {name && (
              <p className="text-[10px] text-muted-foreground font-mono">
                file: {slug}.json
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Description (optional)
            </Label>
            <Textarea
              placeholder="What does this test verify?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-sm min-h-[60px]"
            />
          </div>
          <div className="rounded-md bg-muted/30 p-2 text-[10px] font-mono text-muted-foreground">
            {count} action{count === 1 ? "" : "s"}
            {preview && ` — ${preview}${count > 3 ? ", …" : ""}`}
          </div>
          {error && (
            <p className="text-xs text-destructive font-mono">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!name.trim() || saving || count === 0}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

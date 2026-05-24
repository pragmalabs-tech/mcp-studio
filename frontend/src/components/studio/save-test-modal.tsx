import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recorder } from "@/lib/recorder/recorder";
import { saveTest } from "@/lib/tests/storage";

interface SaveTestModalProps {
  open: boolean;
  startIndex: number;
  endIndex: number;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function SaveTestModal({
  open,
  startIndex,
  endIndex,
  onOpenChange,
  onSaved,
}: SaveTestModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;

    setSaving(true);
    try {
      // Get the session slice
      const session = recorder.serializeRange(startIndex, endIndex);

      // Caller-assigned UUID is the persistent id. Two tests with the
      // same display name save to distinct files because their ids differ.
      const test = {
        id: crypto.randomUUID(),
        name: name.trim(),
        description: description.trim() || undefined,
        createdAt: new Date().toISOString(),
        session,
      };

      await saveTest(test);
      console.log("Test saved:", test.name);

      // Reset and close
      setName("");
      setDescription("");
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save test:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* `<form onSubmit>` makes Enter from any input submit the save
            flow without the user needing to click the button. The Save
            button below uses `type="submit"`. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save Test</DialogTitle>
            <DialogDescription>
              Save this recorded session as a test. You can replay it later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="test-name">Test Name</Label>
              <Input
                id="test-name"
                placeholder="e.g., User login flow"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="test-description">Description (optional)</Label>
              <Textarea
                id="test-description"
                placeholder="Describe what this test covers..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              <p>
                <strong>{endIndex - startIndex}</strong> actions will be saved
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving ? "Saving..." : "Save Test"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

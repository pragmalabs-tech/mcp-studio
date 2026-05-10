import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KeyRound } from "lucide-react";

interface Props {
  open: boolean;
  testName: string;
  profileName: string;
  reason: string;
  onCancel: () => void;
  onConfigure: () => void;
  onProceed: () => void;
}

/**
 * Surfaced when the active profile lacks the auth a test needs. The user
 * can open the auth panel to configure, run anyway (probably a 401), or
 * cancel. The "run anyway" escape hatch lets users replay tests that were
 * recorded against an open server without forcing them through auth setup.
 */
export function TestAuthPreconditionDialog({
  open,
  testName,
  profileName,
  reason,
  onCancel,
  onConfigure,
  onProceed,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-400" />
            Active profile has no auth
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2 text-sm text-muted-foreground">
          <p>
            Replaying{" "}
            <span className="text-foreground font-medium">{testName}</span>{" "}
            against profile{" "}
            <span className="text-foreground font-medium">{profileName}</span>,
            but {reason}. The MCP server will likely reject the request with
            401.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={onProceed}>
            Run anyway
          </Button>
          <Button size="sm" onClick={onConfigure}>
            Configure auth
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

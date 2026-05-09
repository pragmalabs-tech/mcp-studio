import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldOff } from "lucide-react";

interface Props {
  open: boolean;
  testName: string;
  onCancel: () => void;
  onProceed: () => void;
}

export function TestPreconditionDialog({
  open,
  testName,
  onCancel,
  onProceed,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldOff className="h-4 w-4 text-amber-400" />
            Strict CSP is enabled
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2 text-sm text-muted-foreground">
          <p>
            <span className="text-foreground font-medium">{testName}</span>{" "}
            includes widget DOM steps. The recorder bridge cannot run inside the
            iframe under strict CSP, so replay will fail at the first widget
            step.
          </p>
          <p>
            Disable strict CSP for this run? You can re-enable it from Widget
            settings afterward.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onProceed}>
            Disable strict CSP & Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

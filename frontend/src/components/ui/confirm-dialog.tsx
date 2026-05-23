import { create } from "zustand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmTone = "default" | "destructive";

export interface ConfirmOptions {
  /** Short title — what action is the user about to take. */
  title: string;
  /** Optional longer description / consequences. */
  description?: string;
  /** Label on the confirm button (default: "Confirm"). */
  confirmLabel?: string;
  /** Label on the cancel button (default: "Cancel"). */
  cancelLabel?: string;
  /** "destructive" colors the confirm button red — use it for deletes,
   *  irreversible operations, and anything that hits the network in a way
   *  that's hard to undo. */
  tone?: ConfirmTone;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((ok: boolean) => void) | null;
}

const useConfirmStore = create<ConfirmState>(() => ({
  open: false,
  options: null,
  resolve: null,
}));

/**
 * Imperative confirm prompt. Resolves to `true` when the user clicks the
 * confirm button, `false` on cancel or dismiss. Mount `<ConfirmDialogRoot />`
 * once at the app root for this to work.
 *
 * ```ts
 * if (await confirm({ title: "Delete test?", tone: "destructive" })) {
 *   deleteTest(id);
 * }
 * ```
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ open: true, options, resolve });
  });
}

/** Root portal. Render once high in the tree (e.g. inside StudioLayout). */
export function ConfirmDialogRoot() {
  const { open, options, resolve } = useConfirmStore();

  const finish = (ok: boolean) => {
    resolve?.(ok);
    useConfirmStore.setState({ open: false, options: null, resolve: null });
  };

  if (!options) {
    // Render the dialog with open=false so the close animation can play
    // on the very first dismiss; once closed and options cleared, we
    // render nothing.
    return null;
  }

  const tone = options.tone ?? "default";

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options.title}</AlertDialogTitle>
          {options.description ? (
            <AlertDialogDescription>
              {options.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>
            {options.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={tone === "destructive" ? "destructive" : "default"}
            onClick={() => finish(true)}
          >
            {options.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

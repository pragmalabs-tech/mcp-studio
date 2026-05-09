import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { CheckCircle2, FileUp, RefreshCw, XCircle, XIcon } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  listReports,
  getReport,
  type ReportSummary,
} from "@/lib/tests/reports-api";
import { validateReport, type ReplayReport } from "@/lib/engine/report";
import { TestResultModal } from "@/components/studio/test-result-modal";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

export function ReportsPage({ open, onOpenChange }: Props) {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<ReplayReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await listReports());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  async function handleOpenStored(name: string) {
    setBusyName(name);
    setError(null);
    try {
      const report = await getReport(name);
      if (!validateReport(report)) {
        throw new Error("Stored report failed schema validation");
      }
      setOpenReport(report);
      setReportOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!validateReport(parsed)) {
        throw new Error(
          "File is not a valid Studio report (missing required fields or wrong version)",
        );
      }
      setOpenReport(parsed);
      setReportOpen(true);
    } catch (e) {
      setError(`Could not load report: ${(e as Error).message}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed top-0 right-0 z-50 h-screen w-[640px] max-w-[95vw] bg-popover text-sm text-popover-foreground border-l shadow-2xl outline-none flex flex-col data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right duration-150"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 gap-2">
            <DialogPrimitive.Title className="text-sm font-medium flex items-center gap-2">
              Past runs
              <span className="text-xs font-normal text-muted-foreground">
                {reports.length}
              </span>
            </DialogPrimitive.Title>
            <div className="flex items-center gap-1">
              <input
                type="file"
                accept=".json,application/json"
                ref={fileInputRef}
                onChange={handleFilePicked}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                title="Load a report JSON from disk"
              >
                <FileUp className="h-3.5 w-3.5 mr-1.5" />
                Open report
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={refresh}
                title="Refresh"
                disabled={loading}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                />
              </Button>
              <DialogPrimitive.Close
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>
          {error && (
            <div className="px-4 py-2 text-xs text-destructive font-mono border-b">
              {error}
            </div>
          )}
          <div className="flex-1 overflow-y-auto min-h-0">
            {!loading && reports.length === 0 ? (
              <p className="text-center text-muted-foreground text-xs py-12 px-6">
                No saved reports yet. Run a test from the Tests drawer, then
                click <span className="font-medium">Save to disk</span> in the
                result modal — or use{" "}
                <span className="font-medium">Open report</span> to load a
                shared file.
              </p>
            ) : (
              reports.map((r) => (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => handleOpenStored(r.name)}
                  disabled={busyName === r.name}
                  className="w-full text-left px-4 py-3 border-b border-border/30 hover:bg-secondary/20 flex items-start gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {r.testName ?? r.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                      {r.name}
                      {r.startedAt &&
                        ` · ${formatTime(new Date(r.startedAt).getTime())}`}
                      {!r.startedAt &&
                        r.modifiedMs > 0 &&
                        ` · saved ${formatTime(r.modifiedMs)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    {typeof r.passed === "number" && (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        {r.passed}
                      </span>
                    )}
                    {typeof r.failed === "number" && r.failed > 0 && (
                      <span className="inline-flex items-center gap-1 text-red-400">
                        <XCircle className="h-3 w-3" />
                        {r.failed}
                      </span>
                    )}
                    {typeof r.total === "number" && (
                      <span className="text-muted-foreground font-mono">
                        / {r.total}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
      <TestResultModal
        report={openReport}
        open={reportOpen}
        onOpenChange={(v) => {
          setReportOpen(v);
          if (!v) setOpenReport(null);
        }}
      />
    </Dialog>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProfileStore } from "@/lib/studio/stores/profile-store";
import { authLogin, authVerify } from "@/lib/studio/cloud-api";

type Step = "email" | "code";

export function SignInDialog() {
  const open = useProfileStore((s) => s.signInOpen);
  const setOpen = useProfileStore((s) => s.setSignInOpen);
  const cloudAuthCompleted = useProfileStore((s) => s.cloudAuthCompleted);

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("email");
    setEmail("");
    setCode("");
    setRequestId("");
    setBusy(false);
    setError(null);
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await authLogin(email.trim());
      setRequestId(r.request_id);
      setStep("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await authVerify(requestId, code.trim());
      cloudAuthCompleted(r.email);
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        setOpen(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "email"
              ? "Sign in to publish"
              : "Enter verification code"}
          </DialogTitle>
        </DialogHeader>

        {step === "email" ? (
          <form onSubmit={submitEmail} className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="signin-email">Email</Label>
              <Input
                id="signin-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                We'll send a 6-digit code. Uses your cloud.mcpr.app account.
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !email}>
                {busy ? "Sending..." : "Send code"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={submitCode} className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="signin-code">6-digit code</Label>
              <Input
                id="signin-code"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                Sent to {email}. Check your inbox.
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStep("email")}
                disabled={busy}
              >
                Back
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={busy || code.length !== 6}
              >
                {busy ? "Verifying..." : "Verify"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

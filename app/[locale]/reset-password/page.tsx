"use client";

import { useState, useEffect, Suspense } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfig } from "@/hooks/use-config";
import { apiFetch } from "@/lib/browser-navigation";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle, Eye, EyeOff, Loader2 } from "lucide-react";

function ResetPasswordForm() {
  const t = useTranslations("forgot_password");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) setError(t("error_missing_token"));
  }, [token, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t("error_password_too_short"));
      return;
    }
    if (newPassword !== confirm) {
      setError(t("error_password_mismatch"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => router.push("/login"), 3000);
      } else {
        const data = await res.json().catch(() => ({}));
        const code: string = data?.error ?? "";
        if (code === "invalid_token") {
          setError(t("error_invalid_token"));
        } else if (code === "password_too_short") {
          setError(t("error_password_too_short"));
        } else {
          setError(t("error_generic"));
        }
      }
    } catch {
      setError(t("error_generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="p-3 rounded-xl border border-destructive/20 bg-destructive/5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/15 text-destructive flex items-center justify-center flex-shrink-0 shadow-sm">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0 self-center">
            <p className="text-sm text-destructive leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {success ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-green-500" />
          </div>
          <p className="text-sm text-foreground leading-relaxed">{t("reset_success")}</p>
          <Link href="/login" className="text-sm text-primary hover:text-primary/80 transition-colors">
            {t("back_to_login")}
          </Link>
        </div>
      ) : (
        <fieldset disabled={submitting || !token} className="space-y-4">
          {/* New password */}
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="block text-sm font-medium text-foreground">
              {t("password_label")}
            </label>
            <div className="relative">
              <Input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-11 px-3.5 pr-11 bg-muted/40 border-border/60 rounded-xl focus:bg-background focus:border-primary/50 transition-all duration-200"
                placeholder={t("password_placeholder")}
                required
                autoFocus
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t("hide_password") : t("show_password")}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm password */}
          <div className="space-y-1.5">
            <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground">
              {t("confirm_label")}
            </label>
            <Input
              id="confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={cn(
                "h-11 px-3.5 bg-muted/40 border-border/60 rounded-xl focus:bg-background focus:border-primary/50 transition-all duration-200",
                confirm && newPassword !== confirm && "border-destructive/50",
              )}
              placeholder={t("confirm_placeholder")}
              required
              autoComplete="new-password"
            />
          </div>

          <Button
            type="submit"
            className="w-full h-11 font-medium text-[15px] bg-primary hover:bg-primary/90 transition-all duration-200 rounded-xl shadow-md shadow-primary/15 hover:shadow-lg hover:shadow-primary/20"
            disabled={submitting || !token}
          >
            {submitting ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("resetting")}
              </div>
            ) : (
              t("reset_button")
            )}
          </Button>

          <div className="text-center">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("back_to_login")}
            </Link>
          </div>
        </fieldset>
      )}
    </form>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("forgot_password");
  const { appName, loginLogoLightUrl, loginLogoDarkUrl } = useConfig();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background via-muted/10 to-muted/30 relative px-4">
      <div className="w-full max-w-[400px] mx-auto">
        <div className="rounded-2xl border border-border/60 bg-background/80 backdrop-blur-sm shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-10 pb-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 mb-5">
              <img
                src={loginLogoLightUrl}
                alt={appName}
                className="max-w-16 max-h-16 object-contain dark:hidden"
              />
              <img
                src={loginLogoDarkUrl}
                alt={appName}
                className="max-w-16 max-h-16 object-contain hidden dark:block"
              />
            </div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              {t("reset_title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">{t("reset_subtitle")}</p>
          </div>

          <div className="px-8 pb-8">
            {/* useSearchParams requires Suspense */}
            <Suspense
              fallback={
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              }
            >
              <ResetPasswordForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

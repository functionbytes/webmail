"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfig } from "@/hooks/use-config";
import { apiFetch } from "@/lib/browser-navigation";
import { AlertCircle, CheckCircle, Loader2, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const t = useTranslations("forgot_password");
  const { appName, loginLogoLightUrl, loginLogoDarkUrl, forgotPasswordEnabled } = useConfig();

  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  // Guard: if the feature is disabled, don't render the form
  if (!forgotPasswordEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/10 to-muted/30 px-4">
        <div className="w-full max-w-[400px] mx-auto">
          <div className="rounded-2xl border border-border/60 bg-background/80 backdrop-blur-sm shadow-xl shadow-black/5 dark:shadow-black/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("error_invalid_token")}</p>
            <Link
              href="/login"
              className="mt-4 inline-block text-sm text-primary hover:text-primary/80 transition-colors"
            >
              {t("back_to_login")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!res.ok && res.status !== 200) {
        setError(t("error_generic"));
      } else {
        setSubmitted(true);
      }
    } catch {
      setError(t("error_generic"));
    } finally {
      setSubmitting(false);
    }
  };

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
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">{t("subtitle")}</p>
          </div>

          {/* Body */}
          <div className="px-8 pb-8">
            {submitted ? (
              <div className="flex flex-col items-center gap-4 py-2 text-center">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-green-500" />
                </div>
                <p className="text-sm text-foreground leading-relaxed">
                  {t("success_message")}
                </p>
                <Link
                  href="/login"
                  className="text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  {t("back_to_login")}
                </Link>
              </div>
            ) : (
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

                <div className="space-y-1.5">
                  <label
                    htmlFor="reset-username"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t("email_label")}
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="reset-username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="h-11 pl-10 pr-3.5 bg-muted/40 border-border/60 rounded-xl focus:bg-background focus:border-primary/50 transition-all duration-200"
                      placeholder={t("email_placeholder")}
                      required
                      autoFocus
                      autoComplete="username"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 font-medium text-[15px] bg-primary hover:bg-primary/90 transition-all duration-200 rounded-xl shadow-md shadow-primary/15 hover:shadow-lg hover:shadow-primary/20"
                  disabled={submitting}
                >
                  {submitting ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("sending")}
                    </div>
                  ) : (
                    t("submit_button")
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
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

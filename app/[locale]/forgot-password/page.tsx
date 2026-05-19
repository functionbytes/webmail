'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfig } from '@/hooks/use-config';
import { apiFetch } from '@/lib/browser-navigation';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle, Loader2, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const t = useTranslations('forgot_password');
  const { appName, forgotPasswordEnabled } = useConfig();
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Feature-gated: return nothing if admin hasn't enabled this
  if (!forgotPasswordEnabled) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() }),
      });
      if (!res.ok) throw new Error('request_failed');
      setStatus('success');
    } catch {
      setStatus('error');
      setErrorMsg(t('error_generic'));
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background via-muted/10 to-muted/30 px-4">
      <div className="w-full max-w-[400px] mx-auto">
        <div className="rounded-2xl border border-border/60 bg-background/80 backdrop-blur-sm shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden">
          <div className="px-8 pt-10 pb-8">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1.5">
              {t('title')}
            </h1>
            <p className="text-sm text-muted-foreground mb-6">{t('subtitle')}</p>

            {status === 'success' ? (
              <div className="space-y-5">
                <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0 self-center">
                    <p className="text-sm text-emerald-700 dark:text-emerald-300 leading-relaxed">
                      {t('success_message')}
                    </p>
                  </div>
                </div>
                <Link
                  href="/login"
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t('back_to_login')}
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                {status === 'error' && (
                  <div
                    className={cn(
                      'p-3 rounded-xl border border-destructive/20 bg-destructive/5 flex items-start gap-3',
                    )}
                  >
                    <div className="w-10 h-10 rounded-full bg-destructive/15 text-destructive flex items-center justify-center flex-shrink-0 shadow-sm">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0 self-center">
                      <p className="text-sm text-destructive leading-relaxed">{errorMsg}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label
                    htmlFor="fp-username"
                    className="block text-sm font-medium text-foreground"
                  >
                    {t('email_label')}
                  </label>
                  <Input
                    id="fp-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-11 px-3.5 bg-muted/40 border-border/60 rounded-xl focus:bg-background focus:border-primary/50 transition-all duration-200"
                    placeholder={t('email_placeholder')}
                    required
                    autoFocus
                    autoComplete="username"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 font-medium text-[15px] bg-primary hover:bg-primary/90 transition-all duration-200 rounded-xl shadow-md shadow-primary/15 hover:shadow-lg hover:shadow-primary/20"
                  disabled={status === 'loading'}
                >
                  {status === 'loading' ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t('sending')}
                    </div>
                  ) : (
                    t('submit_button')
                  )}
                </Button>

                <Link
                  href="/login"
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t('back_to_login')}
                </Link>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

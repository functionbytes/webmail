'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfig } from '@/hooks/use-config';
import { apiFetch } from '@/lib/browser-navigation';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';

function ResetPasswordForm() {
  const t = useTranslations('forgot_password');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  if (!token) {
    return (
      <div className="p-3 rounded-xl border border-destructive/20 bg-destructive/5 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-destructive/15 text-destructive flex items-center justify-center flex-shrink-0 shadow-sm">
          <AlertCircle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 self-center">
          <p className="text-sm text-destructive leading-relaxed">{t('error_missing_token')}</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (password.length < 8) {
      setErrorMsg(t('error_password_too_short'));
      return;
    }
    if (password !== confirm) {
      setErrorMsg(t('error_password_mismatch'));
      return;
    }
    setStatus('loading');
    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg =
          data.error === 'invalid_token' ? t('error_invalid_token') : t('error_generic');
        setErrorMsg(msg);
        setStatus('error');
        return;
      }
      setStatus('success');
      setTimeout(() => router.push('/login'), 2500);
    } catch {
      setStatus('error');
      setErrorMsg(t('error_generic'));
    }
  };

  if (status === 'success') {
    return (
      <div className="space-y-5">
        <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0 self-center">
            <p className="text-sm text-emerald-700 dark:text-emerald-300 leading-relaxed">
              {t('reset_success')}
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
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {errorMsg && (
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
        <label htmlFor="rp-password" className="block text-sm font-medium text-foreground">
          {t('password_label')}
        </label>
        <div className="relative">
          <Input
            id="rp-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 px-3.5 pr-11 bg-muted/40 border-border/60 rounded-xl focus:bg-background focus:border-primary/50 transition-all duration-200"
            placeholder={t('password_placeholder')}
            required
            autoFocus
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="rp-confirm" className="block text-sm font-medium text-foreground">
          {t('confirm_label')}
        </label>
        <Input
          id="rp-confirm"
          type={showPassword ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-11 px-3.5 bg-muted/40 border-border/60 rounded-xl focus:bg-background focus:border-primary/50 transition-all duration-200"
          placeholder={t('confirm_placeholder')}
          required
          autoComplete="new-password"
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
            {t('resetting')}
          </div>
        ) : (
          t('reset_button')
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
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations('forgot_password');
  const { forgotPasswordEnabled } = useConfig();

  if (!forgotPasswordEnabled) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background via-muted/10 to-muted/30 px-4">
      <div className="w-full max-w-[400px] mx-auto">
        <div className="rounded-2xl border border-border/60 bg-background/80 backdrop-blur-sm shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden">
          <div className="px-8 pt-10 pb-8">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1.5">
              {t('reset_title')}
            </h1>
            <p className="text-sm text-muted-foreground mb-6">{t('reset_subtitle')}</p>
            {/* useSearchParams requires Suspense in Next.js App Router */}
            <Suspense fallback={null}>
              <ResetPasswordForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

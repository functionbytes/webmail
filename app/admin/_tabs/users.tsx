'use client';

import { useState } from 'react';
import { Loader2, Send, UserPlus, Mail } from 'lucide-react';
import { apiFetch } from '@/lib/browser-navigation';

export function UsersTab() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await apiFetch('/api/admin/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() }),
      });

      if (res.ok) {
        setResult({ type: 'success', text: `Invitation sent to the recovery email for "${username.trim()}".` });
        setUsername('');
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setResult({ type: 'error', text: data.error ?? `Request failed (HTTP ${res.status}).` });
      }
    } catch {
      setResult({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage user accounts and send invitations.
        </p>
      </div>

      {/* Invite via recovery email */}
      <div className="border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">Invite User</h2>
        </div>

        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Send an invitation email to a user&apos;s recovery address. The email contains a
            one-time link (valid for 1 hour) to set their initial or replacement password.
          </p>

          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 flex items-start gap-2 text-xs text-muted-foreground">
            <Mail className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              The invite is delivered to the user&apos;s <strong className="text-foreground">recovery email</strong> — set
              by the user in Settings → Security, or via the email addresses on their Stalwart principal.
              If none is configured you will see an error and must ask the user to add one first.
            </span>
          </div>

          <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setResult(null); }}
              placeholder="username or user@domain"
              autoComplete="off"
              autoCapitalize="none"
              disabled={loading}
              className="flex-1 h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !username.trim()}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Send Invite
            </button>
          </form>

          {result && (
            <div
              className={`rounded-md px-3 py-2 text-sm ${
                result.type === 'success'
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20'
                  : 'bg-destructive/10 text-destructive border border-destructive/20'
              }`}
            >
              {result.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

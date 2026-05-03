# Scheduled Send Implementation Plan

Plan for adding server-side scheduled send and optional short "Undo send" delay to Bulwark Webmail.

## Scope

- Add manual "Schedule send" from the composer.
- Add a global composing setting `sendDelaySeconds: 0 | 10 | 30 | 60`; default `0`.
- Use JMAP `EmailSubmission.sendAt` as the only source of truth.
- Add a virtual Scheduled view backed by `EmailSubmission/query`, not a real mailbox.
- Support cancel, reschedule, and non-S/MIME `Cancel and edit`.
- Support S/MIME scheduled send through the raw MIME path, but do not edit signed/encrypted raw messages.
- Do not add browser-local scheduling, per-account delay settings, recurring send, templates, or server compatibility fallbacks in the first implementation.

## Current Code Facts

- Standard send flow: `components/email/email-composer.tsx` -> `app/[locale]/page.tsx` `handleEmailSend` -> `stores/email-store.ts` `sendEmail` -> `lib/jmap/client.ts` `sendEmail`.
- S/MIME flow: composer builds raw MIME, signs/encrypts, then calls `stores/email-store.ts` `sendRawEmail` -> `lib/jmap/client.ts` `sendRawEmail`.
- `lib/jmap/client.ts` `request(methodCalls, using?)` defaults to Core + Mail only. Any request with `Identity/*` or `EmailSubmission/*` must pass submission capability explicitly.
- `lib/jmap/types.ts` already has `EmailSubmission` with `sendAt` and `undoStatus`; add only missing client-only `Email` fields and optional helper types.
- `sendEmail`, `sendRawEmail`, and store wrappers currently return `Promise<void>`; scheduled/undo UX needs a structured result containing the created `EmailSubmission` ID.
- `app/[locale]/page.tsx` sets `$answered`/`$forwarded` immediately in `handleEmailSend`; `handleQuickReply` also sets `$answered` immediately. Scheduled sends must skip those immediate keyword updates.
- The composer already tracks a post-save `finalDraftId` before sending. S/MIME scheduled cleanup must delete that final plaintext draft, not stale component state.
- `stores/settings-store.ts` is the right place for the global delay preference. `components/settings/composing-settings.tsx` is the right settings UI location.
- `stores/email-store.ts` owns the active email list, selection, loading, push handling, and batch operations. Scheduled view integration must not assume a second list is automatically respected everywhere.

## JMAP Requirements

Use this capability list for every request containing `Identity/*` or `EmailSubmission/*`:

```ts
const SUBMISSION_USING = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
  'urn:ietf:params:jmap:submission',
];
```

Delayed send is enabled only when all are true:

- `supportsEmailSubmission()` is true.
- `hasAccountCapability('urn:ietf:params:jmap:submission', accountId)` is true.
- Account capability `maxDelayedSend > 0`.

Add client helpers:

```ts
getMaxDelayedSend(accountId?: string): number;
hasDelayedSend(accountId?: string): boolean;
```

Validate every `sendAt`:

- Valid ISO date.
- Strictly in the future.
- Not later than `Date.now() + maxDelayedSend * 1000`.

When creating scheduled submissions, add `sendAt` to `EmailSubmission/set.create` and keep `onSuccessUpdateEmail` so the server can move Drafts to Sent when delivery succeeds:

```json
{
  "accountId": "account-id",
  "create": {
    "submit": {
      "emailId": "#created-email-or-import",
      "identityId": "identity-id",
      "sendAt": "2026-04-29T08:30:00.000Z"
    }
  },
  "onSuccessUpdateEmail": {
    "#submit": {
      "mailboxIds/drafts-id": null,
      "mailboxIds/sent-id": true,
      "keywords/$draft": null
    }
  }
}
```

Verify server behavior: if `onSuccessUpdateEmail` is applied immediately instead of at release time, Scheduled must still use `EmailSubmission/query` as truth and normal Drafts/Sent UI must guard or hide pending scheduled messages.

## Data Model And Client API

Add a send result and scheduled email shape:

```ts
export interface SendEmailResult {
  scheduled: boolean;
  emailId?: string;
  emailSubmissionId?: string;
  sendAt?: string;
  isSmime?: boolean;
}

export interface ScheduledEmail extends Email {
  scheduledSendAt: string;
  emailSubmissionId: string;
  scheduledIdentityId: string;
  scheduledUndoStatus: 'pending' | 'final' | 'canceled';
  isScheduled: true;
  isSmimeScheduled: boolean;
}
```

Also add optional client-only fields to `Email` for messages that appear in normal mailbox queries:

```ts
scheduledSendAt?: string;
emailSubmissionId?: string;
scheduledIdentityId?: string;
scheduledUndoStatus?: 'pending' | 'final' | 'canceled';
isScheduled?: boolean;
isSmimeScheduled?: boolean;
```

Extend `IJMAPClient` and both client implementations:

```ts
sendEmail(..., sendAt?: string): Promise<SendEmailResult>;
sendRawEmail(blob: Blob, identityId: string, sentMailboxId: string, draftMailboxId?: string, sendAt?: string): Promise<SendEmailResult>;
getScheduledEmails(limit?: number, position?: number): Promise<{ emails: ScheduledEmail[]; hasMore: boolean; total: number }>;
cancelEmailSubmission(submissionId: string): Promise<void>;
rescheduleEmailSubmission(submissionId: string, emailId: string, identityId: string, sendAt: string): Promise<SendEmailResult>;
restoreEmailToDraft(emailId: string, draftMailboxId: string, sentMailboxId?: string): Promise<void>;
```

Implementation notes:

- `sendEmail` adds `sendAt` to both draft and non-draft submission branches, returns `{ scheduled: true, emailId, emailSubmissionId, sendAt }` when `sendAt` is present, otherwise `{ scheduled: false }`.
- `sendRawEmail` imports into Drafts as today, adds `sendAt` to `raw-submit`, keeps `onSuccessUpdateEmail`, and returns `isSmime: true` for delayed/scheduled sends.
- `getScheduledEmails` queries `EmailSubmission` with `undoStatus: pending`, fetches submissions, drops any submission without a valid `sendAt`, fetches referenced emails, merges scheduling metadata, detects S/MIME with existing `detectSmime(...)`, and sorts by `scheduledSendAt` ascending.
- Do not rely only on `sendAt > now`; clock skew can hide near-term submissions. If an `after` filter is added for performance, use a small tolerance and treat `undoStatus: pending` as authoritative.
- Cancel uses `EmailSubmission/set.update` with `undoStatus: 'canceled'`. Do not use `destroy` for cancellation.
- Reschedule validates the new time, creates the replacement for the same `emailId` and `identityId` before canceling the old submission when the server allows multiple pending submissions for the same email, then refreshes scheduled state. If the server requires cancel-first semantics, surface cancel-succeeded/create-failed partial failures, refresh scheduled state, and leave or restore the email as a draft where possible so the user can recover.
- `restoreEmailToDraft` uses `Email/set.update` patches to add Drafts, set `$draft`, and remove Sent only when the Sent mailbox ID is known.

## Store Changes

### `stores/settings-store.ts`

- Add `export type SendDelaySeconds = 0 | 10 | 30 | 60`.
- Add `sendDelaySeconds: SendDelaySeconds` under Composer settings with default `0`.
- Ensure import/migration tolerates missing or invalid values by falling back to `0`.
- Keep runtime pending submissions out of settings state.

### `stores/email-store.ts`

Add scheduled state:

```ts
scheduledEmails: ScheduledEmail[];
scheduledEmailIds: Set<string>;
scheduledSubmissionByEmailId: Map<string, {
  submissionId: string;
  sendAt: string;
  identityId: string;
  undoStatus: 'pending' | 'final' | 'canceled';
}>;
scheduledTotal: number;
scheduledHasMore: boolean;
isLoadingScheduled: boolean;
isScheduledView: boolean;
pendingUndoSend: null | { submissionId: string; emailId?: string; sendAt: string; isSmime: boolean };
```

Add actions:

- `fetchScheduledEmails(client)` and `loadMoreScheduledEmails(client)`.
- `cancelScheduledEmail(client, submissionId)`.
- `cancelScheduledEmailForEdit(client, email)`; cancel first, restore draft, then let page open composer.
- `rescheduleScheduledEmail(client, submissionId, emailId, identityId, sendAt)`.
- `cancelUndoSend(client, pending)`.
- A lightweight refresh action for `scheduledEmailIds`/`scheduledSubmissionByEmailId` on app load and `EmailSubmission` push changes.

Store behavior:

- Scheduled view reads `scheduledEmails`; normal views read `emails`.
- Batch archive/delete/spam/move must no-op or be disabled in Scheduled view.
- Normal Drafts/Sent fetches should annotate or hide emails found in `scheduledEmailIds`. Minimal safe behavior is to show a Scheduled banner and disable normal draft/edit/mailbox actions.
- `cancelUndoSend` cancels the submission, refreshes scheduled metadata, clears `pendingUndoSend`, and returns enough data for the page to reopen non-S/MIME drafts.

## UI Changes

### Settings

File: `components/settings/composing-settings.tsx`

- Add compact `Undo send` / `Send delay` select near existing composing settings.
- Options: `Aus`, `10 seconds`, `30 seconds`, `60 seconds`.
- Persist through `updateSetting('sendDelaySeconds', value)`.
- If the active account lacks delayed-send support, show a non-blocking warning; the saved global preference may still apply to other accounts.

### Composer

File: `components/email/email-composer.tsx`

- Add a Schedule send button/dialog using native `datetime-local`.
- Validate required, valid, future, and within `maxDelayedSend`.
- Change `handleSend(skipAttachmentCheck = false, sendAt?: string)`.
- For normal Send, compute automatic delay only when no explicit schedule exists:

```ts
const effectiveSendAt = sendAt ?? (
  sendDelaySeconds > 0
    ? new Date(Date.now() + sendDelaySeconds * 1000).toISOString()
    : undefined
);
```

- If send delay is configured but unsupported for the active account, do not silently send immediately. Show feedback and require explicit immediate-send confirmation.
- Forward `effectiveSendAt` through standard `onSend` payload and S/MIME `sendRawEmail` path.
- After S/MIME scheduled send succeeds, clear autosave timers/state and delete `finalDraftId` if present. Cleanup failure should show/log a warning but must not fail the already-created scheduled send.

### Page Integration

File: `app/[locale]/page.tsx`

- Add `const SCHEDULED_MAILBOX_ID = '__scheduled__'`.
- Selecting it exits unified mode, clears selected email, sets `isScheduledView`, and calls `fetchScheduledEmails(client)`.
- Define an explicit active list once and use it for rendering, selection, keyboard navigation, mobile list/view behavior, and load-more:

```ts
const activeEmails = isScheduledView ? scheduledEmails : emails;
const activeHasMore = isScheduledView ? scheduledHasMore : hasMoreEmails;
const activeIsLoading = isScheduledView ? isLoadingScheduled : isLoading;
```

- After scheduled/manual-delay send succeeds, close composer, refresh scheduled metadata, and do not refresh the normal mailbox as if delivery already happened unless already in Scheduled view.
- Skip immediate `$answered`/`$forwarded` updates whenever `sendAt` is present. Apply this to both `handleEmailSend` and `handleQuickReply`.
- Auto mark-as-read must be disabled in Scheduled view.
- Push/state handling should refresh scheduled metadata when `StateChange.changed[accountId].EmailSubmission` changes.
- Browser restore and refresh for `__scheduled__` must call `fetchScheduledEmails`, not `fetchEmails`.

### Sidebar, List, Viewer, Context Menu

- `components/layout/sidebar.tsx`: add virtual Scheduled row near Drafts/Sent with pending count. Do not create a JMAP mailbox.
- `components/email/email-list.tsx`: add `isScheduledView` and scheduled action callbacks; hide normal batch/mailbox actions in Scheduled view.
- `components/email/email-viewer.tsx`: render Scheduled banner before Draft banner when `email.isScheduled`; suppress normal reply/forward/archive/spam/move/delete unless explicitly supported.
- Viewer actions: `Reschedule`, `Cancel send`, non-S/MIME `Cancel and edit`, S/MIME `Cancel and compose again`.
- `components/email/email-context-menu.tsx`: show scheduled-specific actions and hide irrelevant mailbox actions for scheduled messages.

## S/MIME Rules

- Scheduled S/MIME messages are final raw MIME after signing/encryption.
- Allow Scheduled view, cancel, and reschedule.
- Do not offer direct edit.
- `Cancel and compose again` may open a fresh composer, but must not decrypt/reuse the scheduled raw payload.
- Never log raw MIME, plaintext body, certificates, private keys, passphrases, or decrypted content.
- Delete the final plaintext autosaved draft after successful S/MIME scheduling.

## Demo, Dev Mock, I18n

- `lib/demo/demo-client.ts`: implement delayed send methods with in-memory pending submissions.
- `app/api/dev-jmap/[...path]/route.ts`: advertise submission account capability with `maxDelayedSend`, and handle `EmailSubmission/query`, `EmailSubmission/get`, create with `sendAt`, and update `undoStatus: 'canceled'`.
- Add translation keys to every `locales/{lang}/common.json`; this repo enforces full locale key parity.

Suggested key groups:

- `email_composer.schedule_send*`
- `settings.email_behavior.send_delay.*`
- `sidebar.scheduled`
- `email_viewer.scheduled_*`, `cancel_scheduled_send`, `reschedule_send`, `cancel_and_edit`, `cancel_and_compose_again`, `undo_send*`
- `email_list.no_scheduled_emails*`

## Error Handling

- Scheduled send failure: keep composer open and show a toast.
- Unsupported manual scheduling: hide or disable the schedule action.
- Unsupported automatic delay: require explicit immediate-send confirmation; do not silently bypass the saved delay.
- Cancel failure `cannotUnsend`: show that the message has already been sent and refresh scheduled state.
- Reschedule partial failure: surface the error, refresh scheduled state, and leave the email as draft where possible.
- Scheduled list failure: show an error/empty state in the list area.

## Tests

Unit tests for `lib/jmap/client.ts`:

- Submission/Identity requests pass `SUBMISSION_USING`.
- `getMaxDelayedSend` and `hasDelayedSend` use account-level capability and `maxDelayedSend`.
- `sendEmail` and `sendRawEmail` include/omit `sendAt` correctly and return `SendEmailResult`.
- `getScheduledEmails` queries pending submissions and merges metadata.
- `cancelEmailSubmission` updates `undoStatus` and handles `cannotUnsend`.
- `rescheduleEmailSubmission` cancels old and creates replacement.
- `restoreEmailToDraft` adds Drafts, sets `$draft`, and removes Sent when provided.

Store/component tests where existing test setup supports them:

- Settings default/persistence for `sendDelaySeconds`.
- Scheduled store load/cancel/reschedule/undo paths and loading/error resets.
- Normal mailbox guard/annotation for pending scheduled IDs.
- Composer date validation, manual `sendAt`, automatic delay, unsupported delay feedback, S/MIME path forwarding, and final draft cleanup.
- Scheduled view disables normal batch actions.
- Scheduled reply/forward and delayed quick reply do not immediately set `$answered`/`$forwarded`.
- Undo snackbar cancels and restores non-S/MIME drafts where possible.

Run:

```sh
npm run test:translations
npm run typecheck && npm run lint
npm run build
```

## Manual Test Matrix

- Standard plain text, HTML, attachments.
- Reply and forward: no immediate `$answered`/`$forwarded` before scheduled release.
- Open Scheduled, Drafts, and Sent before release; pending message is visible only/primarily as scheduled and guarded from normal draft/mailbox actions.
- Cancel, reschedule, and cancel-and-edit standard messages, including server states where the email is still in Drafts or already in Sent.
- Signed, encrypted, and signed+encrypted S/MIME scheduling; no plaintext draft remains; direct edit unavailable.
- Send delay default `Aus`; 10/30/60 second delays; Undo before release; no action until server release; browser closed during delay.
- Account without delayed-send support: schedule hidden/disabled and automatic delay warns instead of silently sending immediately.
- Desktop, tablet, mobile composer and Scheduled view.

## Implementation Phases

1. JMAP foundation: capabilities, `SUBMISSION_USING`, structured send result, `sendAt`, scheduled query/cancel/reschedule/restore, client tests.
2. Store/settings: `sendDelaySeconds`, scheduled state/actions/index, push refresh, normal mailbox guards, store tests.
3. Composer/page: schedule dialog, automatic delay, undo snackbar, S/MIME final draft cleanup, reply/forward keyword guards.
4. Scheduled UI: sidebar row, active-list routing, list/viewer/context-menu actions, disabled invalid batch/mailbox actions.
5. Demo/mock/i18n: in-memory demo behavior, dev JMAP handlers, locale keys, translation test.
6. Verification: typecheck, lint, build, manual test matrix, screenshots/screen recording for PR.

## Key Risks

- Server differences around delayed `onSuccessUpdateEmail` timing.
- Pending scheduled emails leaking into Drafts/Sent without scheduled index refresh.
- Cancel/reschedule racing with release time.
- Global delay setting on accounts without delayed-send support.
- S/MIME duplicate/plaintext drafts if final draft cleanup uses stale IDs.
- Central page/list changes can regress normal sending, selection, shortcuts, and batch actions.

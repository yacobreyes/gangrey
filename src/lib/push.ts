// Web Push for the Imago app.
//
// This exists so the CMS can tell you something happened instead of you having
// to open it and look: a submission arrived, a member's card failed, the
// scheduled newsletter actually went out. Notifications go only to signed-in
// staff who have turned them on, never to readers.
//
// On iOS, web push is delivered only to a site added to the home screen, which
// is how Imago is already used.
import webpush from "web-push";
import { sqliteDocsByType, sqliteMutate } from "./storage/sqlite";

const DOC_TYPE = "pushsub";

export type PushSubscriptionDoc = {
  _id: string;
  _type: typeof DOC_TYPE;
  endpoint: string;
  p256dh: string;
  auth: string;
  user?: string;
  label?: string;
  createdAt?: string;
};

export type PushPayload = {
  title: string;
  body?: string;
  /** Where clicking the notification should land. Defaults to the dashboard. */
  url?: string;
  /** Collapses notifications that supersede each other (same tag replaces). */
  tag?: string;
};

export function pushPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

/** Push is inert until VAPID keys exist, like every other optional integration. */
export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configure(): boolean {
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:editor@gangrey.org",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  return true;
}

// One id per endpoint, so re-subscribing the same device updates in place
// rather than piling up duplicates that all fire at once.
function idFor(endpoint: string): string {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (Math.imul(31, h) + endpoint.charCodeAt(i)) | 0;
  return `${DOC_TYPE}-${(h >>> 0).toString(36)}`;
}

export function listPushSubscriptions(): PushSubscriptionDoc[] {
  return sqliteDocsByType<PushSubscriptionDoc>(DOC_TYPE);
}

export function savePushSubscription(sub: {
  endpoint: string; keys: { p256dh: string; auth: string };
}, user?: string, label?: string): void {
  sqliteMutate([{ createOrReplace: {
    _id: idFor(sub.endpoint),
    _type: DOC_TYPE,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user, label,
    createdAt: new Date().toISOString(),
  } }]);
}

export function removePushSubscription(endpoint: string): void {
  sqliteMutate([{ delete: { id: idFor(endpoint) } }]);
}

/**
 * Deliver to every registered staff device. Never throws: a notification
 * failing must not take down the request that triggered it (a submission is
 * more important than the alert about it).
 *
 * Subscriptions the push service reports as gone (404/410) are deleted, which
 * is how dead devices get cleaned up.
 */
export async function sendPush(payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  if (!configure()) return { sent: 0, pruned: 0 };

  const subs = listPushSubscriptions();
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    url: payload.url ?? "/admin/imago",
    tag: payload.tag,
  });

  let sent = 0, pruned = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        removePushSubscription(s.endpoint);
        pruned++;
      }
    }
  }));

  return { sent, pruned };
}

/** Fire-and-forget wrapper for call sites that must not wait on delivery. */
export function notify(payload: PushPayload): void {
  void sendPush(payload).catch(() => {});
}

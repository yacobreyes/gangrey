#!/usr/bin/env node
/**
 * Generate the VAPID keypair that signs push notifications.
 *
 *     node scripts/gen-vapid.mjs
 *
 * Paste the output into .env.selfhost and redeploy. Run this ONCE: regenerating
 * the keys invalidates every device already subscribed, and they all have to
 * turn notifications on again.
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to .env.selfhost, then redeploy:

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@gangrey.org

Keep the private key secret. Anyone holding it can send notifications
to every device that has subscribed.
`);

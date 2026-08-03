#!/usr/bin/env node
/**
 * Generate the VAPID keypair that signs push notifications.
 *
 *     node scripts/gen-vapid.mjs
 *
 * Deliberately depends on nothing but Node's own crypto. The obvious version
 * of this imports web-push, but the server only ever installs node_modules
 * inside the Docker image, so on the host that import fails. This runs
 * anywhere Node does, including:
 *
 *     docker run --rm -v "$PWD":/w -w /w node:22-slim node scripts/gen-vapid.mjs
 *
 * Paste the output into .env.selfhost and redeploy. Run this ONCE: new keys
 * invalidate every device already subscribed, and each has to opt in again.
 */
import { generateKeyPairSync } from "node:crypto";

// VAPID keys are a plain P-256 keypair in base64url:
//   public  = the 65-byte uncompressed EC point (0x04 ‖ X ‖ Y), which is the
//             tail of the SPKI DER encoding
//   private = the 32-byte scalar, which is JWK's "d"
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-65).toString("base64url");
const priv = privateKey.export({ format: "jwk" }).d;

console.log(`
Add these to .env.selfhost, then redeploy:

VAPID_PUBLIC_KEY=${pub}
VAPID_PRIVATE_KEY=${priv}
VAPID_SUBJECT=mailto:you@gangrey.org

Keep the private key secret. Anyone holding it can send notifications
to every device that has subscribed.
`);

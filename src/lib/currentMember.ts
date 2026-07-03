import { getSessionEmail } from "./memberSession";
import { getMemberByEmail, isActiveMember, type Member } from "./membership";

// Server-side: resolve the signed-in reader to their live membership record.
// Returns the Member (any status) plus a convenience `active` flag. The status
// comes fresh from Sanity on each call so a canceled subscription locks content
// immediately, regardless of the 30-day session cookie.
export async function getCurrentMember(): Promise<{ email: string; member: Member | null; active: boolean } | null> {
  const email = await getSessionEmail();
  if (!email) return null;
  const member = await getMemberByEmail(email);
  return { email, member, active: isActiveMember(member) };
}

// Convenience for gating: is the current visitor an active paying member?
export async function isCurrentVisitorActiveMember(): Promise<boolean> {
  const cur = await getCurrentMember();
  return !!cur?.active;
}

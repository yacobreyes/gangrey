import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { timingSafeEqual } from "crypto";
import { getUserByEmail, type FlatplanUser, type UserRole } from "./users";
import { sqliteMutate } from "./storage/sqlite";

// The bootstrap owner. This email is always allowed and always treated as an
// admin, even before any `user` records exist — so the first sign-in can create
// the rest of the team and nobody can lock themselves out.
const BOOTSTRAP_EMAIL = (process.env.ADMIN_GOOGLE_EMAIL ?? "").trim().toLowerCase();

// Materialize the bootstrap owner as a real admin `user` record on first
// sign-in, so they appear in the Users list and in presence with their name.
// Idempotent (createIfNotExists) and best-effort — never blocks sign-in.
async function ensureBootstrapRecord(email: string, name?: string | null) {
  const [firstName, ...rest] = (name ?? "").trim().split(" ");
  try {
    await sqliteMutate([{
      createIfNotExists: {
        _id: `user-${email.replace(/[^a-z0-9]/g, "-")}`,
        _type: "user",
        email,
        firstName: firstName || "Yacob",
        lastName: rest.join(" ") || "Reyes",
        role: "admin",
        active: true,
      },
    }]);
  } catch { /* token/network issue — bootstrap access still works without it */ }
}

function bootstrapUser(email: string, name?: string | null): FlatplanUser {
  const [firstName, ...rest] = (name ?? "").split(" ");
  return {
    _id: "bootstrap-owner",
    email,
    firstName: firstName || "Owner",
    lastName: rest.join(" ") || undefined,
    role: "admin",
    active: true,
  };
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    // Allow the bootstrap owner, or any active user in the Sanity user list.
    async signIn({ profile }) {
      const p = profile as { email?: string; name?: string } | undefined;
      const email = p?.email?.trim().toLowerCase();
      if (!email) return false;
      if (email === BOOTSTRAP_EMAIL) {
        await ensureBootstrapRecord(email, p?.name);
        return true;
      }
      return !!(await getUserByEmail(email));
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: "/admin/imago",
    error: "/admin/imago",
  },
};

// Resolve the signed-in person to a Flatplan user record (with role), or null.
export async function getCurrentUser(): Promise<FlatplanUser | null> {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.trim().toLowerCase();
    if (!email) return null;
    if (email === BOOTSTRAP_EMAIL) return bootstrapUser(email, session?.user?.name);
    return await getUserByEmail(email);
  } catch {
    return null;
  }
}

export async function isAuthed(): Promise<boolean> {
  return !!(await getCurrentUser());
}

export async function currentRole(): Promise<UserRole | null> {
  return (await getCurrentUser())?.role ?? null;
}

export async function requireAuth(): Promise<FlatplanUser> {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not authorized");
  return u;
}

// Gate admin-only actions (user management). Editors are rejected.
export async function requireAdmin(): Promise<FlatplanUser> {
  const u = await getCurrentUser();
  if (!u || u.role !== "admin") throw new Error("Admins only");
  return u;
}

// Machine access for admin routes driven from the server itself (e.g. the
// archive-import script, which can't carry a Google session): accepts
// `Authorization: Bearer <CRON_SECRET>` as an alternative. Constant-time.
export function cronSecretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Admin session OR a valid CRON_SECRET bearer. Throws if neither.
export async function requireAdminOrCronSecret(req: Request): Promise<void> {
  if (cronSecretOk(req)) return;
  await requireAdmin();
}

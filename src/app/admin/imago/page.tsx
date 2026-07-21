import AdminClient from "./AdminClient";
import { getCurrentUser } from "@/lib/adminAuth";
import { getAllNewslettersAdmin, getAllPostsAdmin } from "@/lib/content";
import { listAllUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function AdminFlatplanPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await getCurrentUser();
  const authed = !!me;
  const { tab } = await searchParams;
  const initialPostTab = tab === "scheduled" || tab === "published" || tab === "drafts" ? tab : "drafts";
  // Server-render both lists so the dashboard paints fully populated. We pass
  // withSearch=false to keep the payload light (no body text), which keeps the
  // server render fast — the client refetches the searchable version after mount.
  let posts: Awaited<ReturnType<typeof getAllPostsAdmin>> = [];
  let newsletters: Awaited<ReturnType<typeof getAllNewslettersAdmin>> = [];
  let users: Awaited<ReturnType<typeof listAllUsers>> = [];
  if (authed) {
    // allSettled so one failing read (e.g. a rate-limited users query) can't
    // blank the posts + newsletters lists. Each failure is logged, not swallowed.
    const [postsR, newslettersR, usersR] = await Promise.allSettled([
      getAllPostsAdmin(false, true),
      getAllNewslettersAdmin(),
      me?.role === "admin" ? listAllUsers() : Promise.resolve([]),
    ]);
    if (postsR.status === "fulfilled") posts = postsR.value;
    else console.error("[imago] posts load failed:", postsR.reason instanceof Error ? postsR.reason.message : postsR.reason);
    if (newslettersR.status === "fulfilled") newsletters = newslettersR.value;
    else console.error("[imago] newsletters load failed:", newslettersR.reason instanceof Error ? newslettersR.reason.message : newslettersR.reason);
    if (usersR.status === "fulfilled") users = usersR.value;
    else console.error("[imago] users load failed:", usersR.reason instanceof Error ? usersR.reason.message : usersR.reason);
  }
  return (
    <AdminClient
      posts={posts}
      initialNewsletters={newsletters}
      initialUsers={users}
      initialAuth={authed}
      initialPanel="dashboard"
      initialPostTab={initialPostTab}
      currentUser={me ? { name: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email, email: me.email, role: me.role } : null}
    />
  );
}

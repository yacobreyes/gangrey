import AdminClient from "../AdminClient";
import { getCurrentUser } from "@/lib/adminAuth";
import { getMediaLibrary, listSubscribers } from "@/lib/content";
import { listAllUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

type Panel = "dashboard" | "media" | "comments" | "about" | "subscribers" | "users" | "analytics" | "submissions" | "archive" | "members" | "more" | "calendar";
const VALID_PANELS: Panel[] = ["dashboard", "media", "comments", "about", "subscribers", "users", "analytics", "submissions", "archive", "members", "more", "calendar"];

export default async function AdminFlatplanPanelPage({ params }: { params: Promise<{ panel: string }> }) {
  const { panel } = await params;
  const me = await getCurrentUser();
  const resolvedPanel: Panel = VALID_PANELS.includes(panel as Panel) ? (panel as Panel) : "dashboard";

  // Server-render the active panel's data so it paints populated instead of
  // popping in after a client fetch. Only the data the panel needs is fetched.
  let initialMedia: Awaited<ReturnType<typeof getMediaLibrary>> = [];
  let initialSubscribers: Awaited<ReturnType<typeof listSubscribers>> = [];
  let initialUsers: Awaited<ReturnType<typeof listAllUsers>> = [];
  if (me) {
    try {
      if (resolvedPanel === "media") initialMedia = await getMediaLibrary();
      else if (resolvedPanel === "subscribers" && me.role === "admin") initialSubscribers = await listSubscribers();
      else if (resolvedPanel === "users" && me.role === "admin") initialUsers = await listAllUsers();
    } catch {}
  }

  return (
    <AdminClient
      posts={[]}
      initialMedia={initialMedia}
      initialSubscribers={initialSubscribers}
      initialUsers={initialUsers}
      initialAuth={!!me}
      initialPanel={resolvedPanel}
      currentUser={me ? { name: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email, email: me.email, role: me.role } : null}
    />
  );
}

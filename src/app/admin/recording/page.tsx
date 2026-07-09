import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/adminAuth";
import { listRecordingLines, listRecordingClips } from "@/lib/recordingStore";
import RecordingEditorClient from "./RecordingEditorClient";

export const dynamic = "force-dynamic";

export default async function RecordingAdminPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/admin/imago");
  let lines: ReturnType<typeof listRecordingLines> = [];
  let clips: ReturnType<typeof listRecordingClips> = [];
  let loadError: string | null = null;
  try {
    lines = listRecordingLines();
    clips = listRecordingClips();
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not read the recording bundle.";
  }
  return <RecordingEditorClient initialLines={lines} initialClips={clips} loadError={loadError} />;
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/adminAuth";
import { listRecordingLines } from "@/lib/recordingStore";
import RecordingEditorClient from "./RecordingEditorClient";

export const dynamic = "force-dynamic";

export default async function RecordingAdminPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/admin/imago");
  let lines: ReturnType<typeof listRecordingLines> = [];
  let loadError: string | null = null;
  try {
    lines = listRecordingLines();
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not read the recording bundle.";
  }
  return <RecordingEditorClient initialLines={lines} loadError={loadError} />;
}

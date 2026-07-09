"use server";

import { requireAuth } from "@/lib/adminAuth";
import {
  listRecordingLines,
  saveRecordingLine,
  findReplaceRecording,
  resetRecordingToBundled,
  type RecordingLine,
} from "@/lib/recordingStore";

export async function getRecordingLines(): Promise<RecordingLine[]> {
  await requireAuth();
  return listRecordingLines();
}

export async function updateRecordingLine(index: number, text: string): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  try {
    saveRecordingLine(index, text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function recordingFindReplace(find: string, replace: string): Promise<{ ok: boolean; count: number; error?: string }> {
  await requireAuth();
  try {
    return { ok: true, count: findReplaceRecording(find, replace) };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : "Replace failed" };
  }
}

export async function recordingReset(): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  try {
    resetRecordingToBundled();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reset failed" };
  }
}

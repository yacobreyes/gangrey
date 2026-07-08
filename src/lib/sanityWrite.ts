// Shared server-side write helpers (mutate + asset upload), used by the admin
// server actions. Historically these wrote to Sanity; the site is now fully
// self-hosted, so the same mutation shapes are applied to the local sqlite
// store. The names are kept so the many call sites don't churn.

import { sqliteMutate, sqliteSaveMedia } from "./storage/sqlite";

export async function sanityMutate(mutations: unknown[]) {
  sqliteMutate(mutations);
  return { results: [] };
}

export async function uploadImageAsset(file: File): Promise<{ assetId: string; url: string }> {
  return sqliteSaveMedia(file.name, Buffer.from(await file.arrayBuffer()));
}

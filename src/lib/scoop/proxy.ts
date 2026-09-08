// The Lead Desk service is standalone (see leaddesk/): its own container,
// scheduler, database and raw archive. Imago is only the interface — these
// helpers forward admin-authed requests over the private network.
export function leaddeskUrl(): string {
  return (process.env.LEADDESK_URL || "http://leaddesk:3100").replace(/\/$/, "");
}

export function leaddeskHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = process.env.LEADDESK_TOKEN;
  return { ...(token ? { "x-leaddesk-token": token } : {}), ...extra };
}

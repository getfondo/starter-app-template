export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Dates render MM-DD-YYYY. Date-only values are formatted from the string, so no timezone shift.
export function formatDate(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const m = DATE_ONLY.exec(v);
  if (m) return `${m[2]}-${m[3]}-${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

// Times render 12 hour with am or pm, in the viewer's local time.
export function formatDateTime(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  let h = d.getHours();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${formatDate(v)} ${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
}

// ISO string to the local "YYYY-MM-DDTHH:mm" a datetime-local input expects.
export function toDateTimeLocal(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// A datetime-local value (local wall time) back to an ISO string.
export function fromDateTimeLocal(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

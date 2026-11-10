import { useEffect, useState } from "react";
import type { FieldSpec, Row } from "../lib/spec";
import { api } from "../lib/api";
import { displayValue } from "../lib/spec";
import { fromDateTimeLocal, toDateTimeLocal } from "../lib/format";
import { FileField } from "./FileField";

type Props = { field: FieldSpec; value: unknown; onChange: (v: unknown) => void };

export function FieldInput({ field, value, onChange }: Props) {
  const id = `f-${field.name}`;
  const str = value == null ? "" : String(value);
  switch (field.type) {
    case "long_text":
      return <textarea id={id} value={str} required={field.required} onChange={(e) => onChange(e.target.value)} />;
    case "number":
    case "money":
      return <input id={id} type="number" step={field.type === "money" ? "0.01" : "any"} value={str} required={field.required} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "date":
      return <input id={id} type="date" value={str.slice(0, 10)} required={field.required} onChange={(e) => onChange(e.target.value || null)} />;
    case "datetime":
      return <input id={id} type="datetime-local" value={toDateTimeLocal(value)} required={field.required} onChange={(e) => onChange(fromDateTimeLocal(e.target.value))} />;
    case "boolean":
      return <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case "email":
      return <input id={id} type="email" value={str} required={field.required} onChange={(e) => onChange(e.target.value)} />;
    case "url":
      return <input id={id} type="url" value={str} required={field.required} onChange={(e) => onChange(e.target.value)} />;
    case "choice":
      return (
        <select id={id} value={str} required={field.required} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose</option>
          {(field.choices ?? []).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      );
    case "file":
      return <FileField value={str} onChange={onChange} />;
    case "reference":
      return <ReferenceSelect field={field} value={str} onChange={onChange} />;
    default:
      return <input id={id} type="text" value={str} required={field.required} onChange={(e) => onChange(e.target.value)} />;
  }
}

function ReferenceSelect({ field, value, onChange }: { field: FieldSpec; value: string; onChange: (v: unknown) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (field.referencePath) void api<Row[]>(`/api/${field.referencePath}`).then(setRows).catch(() => setRows([]));
  }, [field.referencePath]);
  return (
    <select value={value} required={field.required} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Choose</option>
      {rows.map((r) => (
        <option key={r.id} value={r.id}>{displayValue(r, [])}{" "}{labelFor(r)}</option>
      ))}
    </select>
  );
}

function labelFor(r: Row): string {
  const text = Object.entries(r).find(([k, v]) => typeof v === "string" && !["id", "owner_id", "created_at", "updated_at"].includes(k) && v.length > 0);
  return text ? String(text[1]) : "";
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { EntitySpec, Row } from "../lib/spec";
import { capitalize, formatDate, formatDateTime } from "../lib/format";

export function EntityList({ spec }: { spec: EntitySpec }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Row[]>(`/api/${spec.path}`).then(setRows).catch((e: Error) => setError(e.message));
  }, [spec.path]);
  const columns = spec.fields.filter((f) => f.type !== "long_text" && f.type !== "file").slice(0, 5);
  return (
    <section>
      <header className="row">
        <h1>{capitalize(spec.labelPlural)}</h1>
        <Link className="button" to={`/${spec.path}/new`}>New {spec.label}</Link>
      </header>
      {error ? <p className="error">{error}</p> : null}
      {rows === null ? <p>Loading</p> : rows.length === 0 ? <p className="muted">No {spec.labelPlural} yet.</p> : (
        <table>
          <thead>
            <tr>{columns.map((c) => <th key={c.name}>{c.label}</th>)}<th>Added</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {columns.map((c, i) => (
                  <td key={c.name}>{i === 0 ? <Link to={`/${spec.path}/${r.id}`}>{format(r[c.name], c.type)}</Link> : format(r[c.name], c.type)}</td>
                ))}
                <td>{formatDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function format(v: unknown, type: string): string {
  if (v == null) return "";
  if (type === "boolean") return v ? "Yes" : "No";
  if (type === "date") return formatDate(v);
  if (type === "datetime") return formatDateTime(v);
  if (type === "money") return `$${Number(v).toFixed(2)}`;
  if (type === "reference") return String(v).slice(0, 8);
  return String(v);
}

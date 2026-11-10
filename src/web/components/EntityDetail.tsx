import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { EntitySpec, Row } from "../lib/spec";
import { FieldInput } from "./FieldInput";
import { capitalize, formatDateTime } from "../lib/format";

export function EntityDetail({ spec }: { spec: EntitySpec }) {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const navigate = useNavigate();
  const [row, setRow] = useState<Partial<Row>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRow({});
    setError(null);
    if (!isNew && id) api<Row>(`/api/${spec.path}/${id}`).then(setRow).catch((e: Error) => setError(e.message));
  }, [spec.path, id, isNew]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {};
    for (const f of spec.fields) body[f.name] = row[f.name] ?? null;
    try {
      if (isNew) {
        const created = await api<Row>(`/api/${spec.path}`, { method: "POST", body: JSON.stringify(body) });
        navigate(`/${spec.path}/${created.id}`);
      } else {
        setRow(await api<Row>(`/api/${spec.path}/${id}`, { method: "PUT", body: JSON.stringify(body) }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!id || !window.confirm(`Delete this ${spec.label}?`)) return;
    try {
      await api(`/api/${spec.path}/${id}`, { method: "DELETE" });
      navigate(`/${spec.path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  return (
    <section>
      <p><Link to={`/${spec.path}`}>All {spec.labelPlural}</Link></p>
      <h1>{isNew ? `New ${spec.label}` : capitalize(spec.label)}</h1>
      {error ? <p className="error">{error}</p> : null}
      <form onSubmit={save} className="form">
        {spec.fields.map((f) => (
          <label key={f.name} htmlFor={`f-${f.name}`}>
            <span>{f.label}{f.required ? " *" : ""}</span>
            <FieldInput field={f} value={row[f.name]} onChange={(v) => setRow((r) => ({ ...r, [f.name]: v }))} />
          </label>
        ))}
        <div className="row">
          <button type="submit" disabled={saving}>{saving ? "Saving" : "Save"}</button>
          {!isNew ? <button type="button" className="danger" onClick={remove}>Delete</button> : null}
        </div>
        {!isNew && row.updated_at ? <p className="muted">Last saved {formatDateTime(row.updated_at)}</p> : null}
      </form>
    </section>
  );
}

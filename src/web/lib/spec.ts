export type FieldType = "text" | "long_text" | "number" | "money" | "date" | "datetime" | "boolean" | "email" | "url" | "file" | "choice" | "reference";

export type FieldSpec = {
  name: string;          // column name used in API payloads
  label: string;
  type: FieldType;
  required: boolean;
  choices?: string[];    // type "choice"
  referencePath?: string; // type "reference": API path of the referenced entity, e.g. "projects"
};

export type EntitySpec = {
  name: string;
  label: string;
  labelPlural: string;
  path: string;
  fields: FieldSpec[];
};

export type Row = { id: string; created_at: string; updated_at: string } & Record<string, unknown>;

export function displayValue(row: Row, fields: FieldSpec[]): string {
  const first = fields.find((f) => f.type === "text" || f.type === "email" || f.type === "url");
  const v = first ? row[first.name] : undefined;
  return typeof v === "string" && v.length > 0 ? v : row.id.slice(0, 8);
}

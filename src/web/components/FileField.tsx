import { useState } from "react";
import { uploadFile } from "../lib/api";

export function FileField({ value, onChange }: { value: string; onChange: (blobName: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="file-field">
      <input
        type="file"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            onChange(await uploadFile(file));
          } catch (err) {
            setError(err instanceof Error ? err.message : "upload failed");
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy ? <span>Uploading</span> : value ? <span className="muted">Saved as {value.split("/").pop()}</span> : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}

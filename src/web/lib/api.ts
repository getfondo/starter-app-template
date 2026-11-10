import { getToken } from "./auth";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function uploadFile(file: File): Promise<string> {
  const token = await getToken();
  const body = new FormData();
  body.append("file", file, file.name);
  const res = await fetch("/api/uploads", { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
  if (!res.ok) throw new Error(res.status === 413 ? "That file is over 25 MB." : res.status === 415 ? "That kind of file is not allowed." : `upload failed: ${res.status}`);
  return ((await res.json()) as { blobName: string }).blobName;
}

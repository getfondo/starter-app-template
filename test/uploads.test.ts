import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { pipeline, type Readable } from "node:stream";
import { buildApp } from "../src/server/app.js";
import { createDb } from "../src/server/db/client.js";
import { UploadTooLarge, limitBytes, type BlobStore } from "../src/server/blob.js";
import { UPLOAD_MAX_BYTES } from "../src/server/routes/uploads.js";
import { testIssuer, type TestIssuer } from "./helpers/auth.js";

function multipart(name: string, type: string, body: Buffer) {
  const boundary = "----fondo" + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, body, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const puts: { blobName: string; contentType: string }[] = [];
const removes: string[] = [];
const committed: string[] = [];
let removeFails = false;
const blob: BlobStore = {
  async ensureLocal() {},
  async roundTrip() {},
  // Runs the real counting logic. A blob only counts as committed when the whole stream drained without error.
  async put(blobName, body, contentType, maxBytes) {
    puts.push({ blobName, contentType });
    if (blobName.endsWith("-boom.txt")) throw new Error("storage exploded");
    const counter = limitBytes(maxBytes ?? Number.POSITIVE_INFINITY);
    pipeline(body as Readable, counter, () => {});
    for await (const _chunk of counter) void _chunk;
    committed.push(blobName);
    return { size: counter.count() };
  },
  async remove(blobName) {
    removes.push(blobName);
    if (removeFails) throw new Error("delete failed");
  },
};

let app: FastifyInstance;
let issuer: TestIssuer;

beforeAll(async () => {
  issuer = await testIssuer();
  const db = createDb({ kind: "url", url: "postgres://nobody:nobody@127.0.0.1:1/none" }).db;
  app = await buildApp({
    db,
    blob,
    auth: { issuer: issuer.issuer, audience: issuer.audience, getKey: issuer.getKey },
    publicConfig: { keycloakUrl: "http://localhost:8080", realm: "test", clientId: "web" },
    logLevel: "silent",
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function post(m: { payload: Buffer; headers: Record<string, string> }, auth = true) {
  const authorization = auth ? { authorization: `Bearer ${await issuer.token(["member"], "uploader")}` } : {};
  return app.inject({ method: "POST", url: "/api/uploads", payload: m.payload, headers: { ...m.headers, ...authorization } });
}

describe("POST /api/uploads", () => {
  it("401 without a token", async () => {
    expect((await post(multipart("a.txt", "text/plain", Buffer.from("hi")), false)).statusCode).toBe(401);
  });

  it("201 streams an allowed file to the blob store", async () => {
    puts.length = 0;
    const res = await post(multipart("notes.txt", "text/plain", Buffer.from("hello")));
    expect(res.statusCode, res.body).toBe(201);
    const json = res.json() as { blobName: string; size: number; contentType: string };
    expect(json.blobName.startsWith("uploader/")).toBe(true);
    expect(json.blobName.endsWith("-notes.txt")).toBe(true);
    expect(json).toMatchObject({ size: 5, contentType: "text/plain" });
    expect(puts).toEqual([{ blobName: json.blobName, contentType: "text/plain" }]);
  });

  it("415 for a type that is not allowed, and nothing is stored", async () => {
    puts.length = 0;
    const res = await post(multipart("evil.exe", "application/x-msdownload", Buffer.from("MZ")));
    expect(res.statusCode).toBe(415);
    expect(puts).toHaveLength(0);
  });

  it("413 over 25 MB, and the partial blob is removed", async () => {
    puts.length = 0;
    removes.length = 0;
    committed.length = 0;
    const res = await post(multipart("big.txt", "text/plain", Buffer.alloc(UPLOAD_MAX_BYTES + 1, 97)));
    expect(res.statusCode).toBe(413);
    expect(puts).toHaveLength(1);
    expect(committed).toHaveLength(0);
    expect(removes).toEqual([puts[0]!.blobName]);
  });

  it("413 still returns when removing the blob fails", async () => {
    removeFails = true;
    try {
      const res = await post(multipart("big.txt", "text/plain", Buffer.alloc(UPLOAD_MAX_BYTES + 1, 97)));
      expect(res.statusCode).toBe(413);
    } finally {
      removeFails = false;
    }
  });

  it("exactly 25 MB is accepted", async () => {
    const res = await post(multipart("max.txt", "text/plain", Buffer.alloc(UPLOAD_MAX_BYTES, 97)));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ size: UPLOAD_MAX_BYTES });
  });

  it("415 when the extension does not match the declared type", async () => {
    puts.length = 0;
    expect((await post(multipart("evil.exe", "text/plain", Buffer.from("MZ")))).statusCode).toBe(415);
    expect((await post(multipart("noext", "text/plain", Buffer.from("x")))).statusCode).toBe(415);
    expect((await post(multipart("photo.png", "image/jpeg", Buffer.from("x")))).statusCode).toBe(415);
    expect(puts).toHaveLength(0);
  });

  it("201 for a content type with parameters and an upper case extension", async () => {
    expect((await post(multipart("notes.txt", "text/plain; charset=utf-8", Buffer.from("x")))).statusCode).toBe(201);
    expect((await post(multipart("PHOTO.JPG", "image/jpeg", Buffer.from("x")))).statusCode).toBe(201);
  });

  it("415 for a disallowed type with parameters", async () => {
    expect((await post(multipart("a.html", "text/html; charset=utf-8", Buffer.from("x")))).statusCode).toBe(415);
  });

  it("500 (not a hang) when storage fails mid-upload", async () => {
    const res = await post(multipart("boom.txt", "text/plain", Buffer.from("x")));
    expect(res.statusCode).toBe(500);
  });

  it("400 when the body has no file part", async () => {
    const boundary = "----fondoempty";
    const res = await post({ payload: Buffer.from(`--${boundary}--\r\n`), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    expect(res.statusCode).toBe(400);
  });

  it("the old /api/uploads/sign route is gone", async () => {
    const res = await app.inject({ method: "POST", url: "/api/uploads/sign", payload: {}, headers: { authorization: `Bearer ${await issuer.token(["member"])}` } });
    expect(res.statusCode).toBe(404);
  });
});

describe("limitBytes", () => {
  it("passes up to the cap and errors with UploadTooLarge past it", async () => {
    const ok = limitBytes(4);
    ok.end(Buffer.from("abcd"));
    for await (const _c of ok) void _c;
    expect(ok.count()).toBe(4);
    const over = limitBytes(4);
    over.end(Buffer.from("abcde"));
    await expect((async () => { for await (const _c of over) void _c; })()).rejects.toBeInstanceOf(UploadTooLarge);
  });
});

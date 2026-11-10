import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { UploadTooLarge, type BlobStore } from "../blob.js";

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
// One map: declared content type -> filename extensions it may carry.
const EXTENSIONS: Record<string, readonly string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};
export const UPLOAD_CONTENT_TYPES: readonly string[] = Object.keys(EXTENSIONS);

// Files stream through the API into the private container. The browser never talks to storage.
export async function uploadRoutes(app: FastifyInstance, opts: { blob: BlobStore }): Promise<void> {
  // The multipart cap is one byte over the real cap so the byte counter in blob.put sees the overflow and aborts before commit.
  await app.register(multipart, { limits: { fileSize: UPLOAD_MAX_BYTES + 1, files: 1, fields: 0 }, throwFileSizeLimit: false });

  app.post("/uploads", { preHandler: app.requireUser }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no_file" });
    const contentType = file.mimetype.split(";")[0]!.trim().toLowerCase();
    if (!Object.hasOwn(EXTENSIONS, contentType) || !EXTENSIONS[contentType]!.includes(extname(file.filename).toLowerCase())) {
      file.file.resume();
      return reply.code(415).send({ error: "unsupported_type", allowed: UPLOAD_CONTENT_TYPES });
    }
    const safeName = file.filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "file";
    const owner = req.user!.sub.replace(/[^A-Za-z0-9-]/g, "_");
    const blobName = `${owner}/${randomUUID()}-${safeName}`;
    const tooLarge = async () => {
      // Best-effort backstop: put never commits an oversize blob, but make sure nothing is left behind.
      try {
        await opts.blob.remove(blobName);
      } catch (err) {
        req.log.warn({ err, blobName }, "could not remove oversize upload");
      }
      return reply.code(413).send({ error: "too_large", maxBytes: UPLOAD_MAX_BYTES });
    };
    let size: number;
    try {
      ({ size } = await opts.blob.put(blobName, file.file, contentType, UPLOAD_MAX_BYTES));
    } catch (err) {
      if (err instanceof UploadTooLarge || file.file.truncated) return tooLarge();
      throw err;
    }
    if (file.file.truncated || size > UPLOAD_MAX_BYTES) return tooLarge();
    return reply.code(201).send({ blobName, size, contentType });
  });
}

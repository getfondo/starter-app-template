import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { Transform, pipeline, type Readable } from "node:stream";

export class UploadTooLarge extends Error {
  constructor(readonly maxBytes: number) {
    super(`upload exceeds ${maxBytes} bytes`);
  }
}

/** Counts bytes and errors with UploadTooLarge as soon as more than maxBytes pass, so nothing oversize is ever committed. */
export function limitBytes(maxBytes: number): Transform & { count: () => number } {
  let seen = 0;
  const t = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) return cb(new UploadTooLarge(maxBytes));
      cb(null, chunk);
    },
  });
  return Object.assign(t, { count: () => seen });
}

export type BlobStoreOptions = {
  accountName: string;
  blobEndpoint: string;
  containerName: string;
  connectionString?: string; // set locally for Azurite; unset in Azure so DefaultAzureCredential (managed identity) is used
};

export type BlobStore = {
  ensureLocal(): Promise<void>;
  roundTrip(): Promise<void>;
  put(blobName: string, body: NodeJS.ReadableStream, contentType: string, maxBytes?: number): Promise<{ size: number }>;
  remove(blobName: string): Promise<void>;
};

export function createBlobStore(o: BlobStoreOptions): BlobStore {
  const local = Boolean(o.connectionString);
  const service = local
    ? BlobServiceClient.fromConnectionString(o.connectionString!)
    : new BlobServiceClient(o.blobEndpoint, new DefaultAzureCredential());
  const container = service.getContainerClient(o.containerName);

  return {
    // Azurite starts empty. In Azure the container comes from Bicep.
    async ensureLocal() {
      if (!local) return;
      await container.createIfNotExists();
    },

    async roundTrip() {
      const name = `healthz/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
      const blob = container.getBlockBlobClient(name);
      const body = `ok ${new Date().toISOString()}`;
      await blob.upload(body, Buffer.byteLength(body));
      const read = (await blob.downloadToBuffer()).toString("utf8");
      await blob.delete();
      if (read !== body) throw new Error("blob did not round-trip");
    },

    async put(blobName, body, contentType, maxBytes = Number.POSITIVE_INFINITY) {
      const counter = limitBytes(maxBytes);
      // pipeline destroys both streams on error, so an oversize upload rejects before the blob is committed.
      pipeline(body as Readable, counter, () => {});
      await container.getBlockBlobClient(blobName).uploadStream(counter, 4 * 1024 * 1024, 4, { blobHTTPHeaders: { blobContentType: contentType } });
      return { size: counter.count() };
    },

    async remove(blobName) {
      await container.getBlockBlobClient(blobName).deleteIfExists();
    },
  };
}

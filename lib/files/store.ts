import "server-only";

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where uploaded files live. On Vercel: Vercel Blob, private (no public URL; the read-write token
 * stays on the server). Locally: files under .data/uploads, or memory in tests and e2e. A
 * deployment without BLOB_READ_WRITE_TOKEN refuses uploads instead of keeping files on a
 * serverless disk that disappears.
 */
export interface FileStore {
  readonly kind: "blob" | "disk" | "memory";
  /** Stores the bytes at a path chosen by the caller; returns the key to delete them by. */
  put(path: string, bytes: Uint8Array, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
  /** Tests only: what is stored. */
  has?(key: string): boolean;
}

type Env = Record<string, string | undefined>;

export class FilesNotConfiguredError extends Error {
  constructor() {
    super("File storage is not set up on this deployment (BLOB_READ_WRITE_TOKEN).");
    this.name = "FilesNotConfiguredError";
  }
}

class BlobStore implements FileStore {
  readonly kind = "blob" as const;
  constructor(private readonly token: string) {}

  async put(path: string, bytes: Uint8Array, contentType: string) {
    const { put } = await import("@vercel/blob");
    const res = await put(path, Buffer.from(bytes), { access: "private", contentType, addRandomSuffix: true, token: this.token });
    return res.pathname;
  }

  async delete(key: string) {
    const { del } = await import("@vercel/blob");
    await del(key, { token: this.token });
  }
}

class DiskStore implements FileStore {
  readonly kind = "disk" as const;
  constructor(private readonly root: string) {}

  async put(path: string, bytes: Uint8Array) {
    const key = `${path}.${crypto.randomUUID().slice(0, 8)}`;
    const file = join(this.root, key);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, bytes);
    return key;
  }

  async delete(key: string) {
    if (key.includes("..")) return;
    await rm(join(this.root, key), { force: true });
  }
}

export class MemoryStore implements FileStore {
  readonly kind = "memory" as const;
  private readonly files = new Map<string, Uint8Array>();

  async put(path: string, bytes: Uint8Array) {
    const key = `${path}.${crypto.randomUUID().slice(0, 8)}`;
    this.files.set(key, bytes);
    return key;
  }

  async delete(key: string) {
    this.files.delete(key);
  }

  has(key: string) {
    return this.files.has(key);
  }

  get size() {
    return this.files.size;
  }
}

const shared = globalThis as typeof globalThis & { __takeoverFiles?: FileStore };

export function fileStoreKind(env: Env = process.env): FileStore["kind"] | "off" {
  if (env.BLOB_READ_WRITE_TOKEN?.trim()) return "blob";
  if (env.VERCEL_ENV) return "off";
  return env.TAKEOVER_DB === "memory" ? "memory" : "disk";
}

export function getFileStore(env: Env = process.env): FileStore {
  if (shared.__takeoverFiles) return shared.__takeoverFiles;
  const kind = fileStoreKind(env);
  if (kind === "off") throw new FilesNotConfiguredError();
  shared.__takeoverFiles =
    kind === "blob" ? new BlobStore(env.BLOB_READ_WRITE_TOKEN!.trim()) : kind === "memory" ? new MemoryStore() : new DiskStore(join(process.cwd(), ".data", "uploads"));
  return shared.__takeoverFiles;
}

/** Tests: use this store instead. */
export function setFileStore(store: FileStore | undefined) {
  shared.__takeoverFiles = store;
}

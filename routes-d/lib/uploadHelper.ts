import crypto from "crypto";

export type StoredFile = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  presignedUrl: string;
  uploadedAt: string;
};

const fileStore = new Map<string, StoredFile>();

export function generatePresignedUrl(fileName: string, contentType: string): string {
  const expires = Date.now() + 3600000;
  const encodedName = encodeURIComponent(fileName);
  return `https://storage.nextellar.dev/kyc/${crypto.randomUUID()}?filename=${encodedName}&contentType=${encodeURIComponent(contentType)}&expires=${expires}&signature=mock-sig`;
}

export async function storeFile(
  fileName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<StoredFile> {
  const id = crypto.randomUUID();
  const presignedUrl = generatePresignedUrl(fileName, mimeType);

  const record: StoredFile = {
    id,
    fileName,
    mimeType,
    size: buffer.length,
    presignedUrl,
    uploadedAt: new Date().toISOString(),
  };

  fileStore.set(id, record);
  return record;
}

export function __resetUploads(): void {
  fileStore.clear();
}

export function __getUploads(): Map<string, StoredFile> {
  return fileStore;
}

export function __getUpload(id: string): StoredFile | undefined {
  return fileStore.get(id);
}

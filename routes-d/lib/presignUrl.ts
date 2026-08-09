/**
 * Pre-signed URL Generator
 * 
 * Generates pre-signed URLs for client uploads so large files never traverse the API server.
 * Supports bucket and key policies, TTL configuration, and content type validation.
 */

import * as crypto from 'crypto';

export interface PresignOptions {
  bucket: string;
  key: string;
  ttl?: number; // Time to live in seconds (default: 3600 = 1 hour)
  contentType?: string; // Optional content type restriction
  method?: 'PUT' | 'POST' | 'GET'; // HTTP method (default: PUT)
  maxSize?: number; // Maximum file size in bytes
}

export interface PresignResult {
  url: string;
  expiresAt: Date;
  method: string;
  headers: Record<string, string>;
}

export interface PresignLogEntry {
  id: string;
  userId: string;
  bucket: string;
  key: string;
  contentType?: string;
  issuedAt: Date;
  expiresAt: Date;
  method: string;
}

// In-memory log of issued pre-signed URLs (can be replaced with database storage)
const presignLog = new Map<string, PresignLogEntry>();

/**
 * Generate a pre-signed URL for file upload
 * 
 * @param options - Presign options including bucket, key, TTL, and content type
 * @param userId - User ID requesting the presigned URL
 * @returns Presign result with URL, expiration, and required headers
 */
export function generatePresignUrl(
  options: PresignOptions,
  userId: string
): PresignResult {
  const {
    bucket,
    key,
    ttl = 3600,
    contentType,
    method = 'PUT',
    maxSize,
  } = options;

  // Validate TTL
  if (ttl <= 0 || ttl > 86400) {
    throw new Error('TTL must be between 1 and 86400 seconds (24 hours)');
  }

  // Validate content type if provided
  if (contentType && !isValidContentType(contentType)) {
    throw new Error(`Invalid content type: ${contentType}`);
  }

  const expiresAt = new Date(Date.now() + ttl * 1000);
  const timestamp = Date.now();

  // Generate a unique signature for this presigned URL
  const signatureData = `${method}:${bucket}:${key}:${timestamp}:${ttl}:${contentType || ''}:${maxSize || ''}`;
  const signature = crypto
    .createHmac('sha256', getSecretKey())
    .update(signatureData)
    .digest('hex');

  // Construct the pre-signed URL
  const url = constructPresignedUrl(bucket, key, signature, expiresAt, method, contentType, maxSize);

  // Build required headers
  const headers: Record<string, string> = {};
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  if (maxSize) {
    headers['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD';
  }

  // Log the issuance
  const logEntry: PresignLogEntry = {
    id: crypto.randomUUID(),
    userId,
    bucket,
    key,
    contentType,
    issuedAt: new Date(),
    expiresAt,
    method,
  };
  presignLog.set(logEntry.id, logEntry);

  return {
    url,
    expiresAt,
    method,
    headers,
  };
}

/**
 * Validate a pre-signed URL
 * 
 * @param url - The pre-signed URL to validate
 * @returns True if the URL is valid and not expired
 */
export function validatePresignUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const expires = urlObj.searchParams.get('expires');
    const signature = urlObj.searchParams.get('signature');

    if (!expires || !signature) {
      return false;
    }

    const expiresDate = new Date(parseInt(expires, 10));
    if (expiresDate < new Date()) {
      return false;
    }

    // Reconstruct signature data and verify
    const bucket = urlObj.searchParams.get('bucket');
    const key = urlObj.searchParams.get('key');
    const method = urlObj.searchParams.get('method') || 'PUT';
    const contentType = urlObj.searchParams.get('contentType');
    const maxSize = urlObj.searchParams.get('maxSize');

    const signatureData = `${method}:${bucket}:${key}:${expires}:${contentType || ''}:${maxSize || ''}`;
    const expectedSignature = crypto
      .createHmac('sha256', getSecretKey())
      .update(signatureData)
      .digest('hex');

    return signature === expectedSignature;
  } catch (error) {
    return false;
  }
}

/**
 * Check if a content type is valid
 * 
 * @param contentType - Content type to validate
 * @returns True if the content type is allowed
 */
function isValidContentType(contentType: string): boolean {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/zip',
    'text/plain',
    'text/csv',
    'application/json',
    'application/xml',
    'video/mp4',
    'video/quicktime',
    'audio/mpeg',
    'audio/wav',
  ];

  return allowedTypes.includes(contentType.toLowerCase());
}

/**
 * Get the secret key for signature generation
 * In production, this should come from environment variables
 */
function getSecretKey(): string {
  return process.env.PRESIGN_SECRET_KEY || 'default-secret-key-change-in-production';
}

/**
 * Construct a pre-signed URL
 */
function constructPresignedUrl(
  bucket: string,
  key: string,
  signature: string,
  expiresAt: Date,
  method: string,
  contentType?: string,
  maxSize?: number
): string {
  const baseUrl = process.env.STORAGE_BASE_URL || 'https://storage.example.com';
  const url = new URL(`${baseUrl}/${bucket}/${key}`);
  
  url.searchParams.set('signature', signature);
  url.searchParams.set('expires', expiresAt.getTime().toString());
  url.searchParams.set('method', method);
  
  if (contentType) {
    url.searchParams.set('contentType', contentType);
  }
  
  if (maxSize) {
    url.searchParams.set('maxSize', maxSize.toString());
  }

  return url.toString();
}

/**
 * Get log entries for a user
 * 
 * @param userId - User ID to get logs for
 * @returns Array of presign log entries
 */
export function getPresignLogs(userId: string): PresignLogEntry[] {
  return Array.from(presignLog.values())
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
}

/**
 * Clear expired log entries
 */
export function clearExpiredLogs(): void {
  const now = new Date();
  const entriesArray = Array.from(presignLog.entries());
  for (const [id, entry] of entriesArray) {
    if (entry.expiresAt < now) {
      presignLog.delete(id);
    }
  }
}

/**
 * Clear all presign logs (useful for testing)
 */
export function clearPresignLogs(): void {
  presignLog.clear();
}

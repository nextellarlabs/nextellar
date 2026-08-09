# KYC Document Upload Endpoint

## Summary

Add `POST /kyc/upload` endpoint that accepts KYC document uploads through multipart form data for partners that require identity verification.

## Changes

- **`routes-d/lib/uploadHelper.ts`** — Pre-signed upload helper with in-memory file store. Provides `generatePresignedUrl` for mock URL generation, `storeFile` for persisting uploaded file metadata, and test helpers (`__resetUploads`, `__getUploads`, `__getUpload`).

- **`routes-d/routes/kyc.upload.ts`** — `POST /kyc/upload` endpoint with:
  - Multipart file upload via `multer` (memory storage)
  - Authentication via `x-user-id` header
  - File size validation (configurable via `KYC_MAX_FILE_SIZE` env var, default 10MB)
  - MIME type validation via multer `fileFilter` (PDF, PNG, JPEG, GIF, WebP)
  - Magic byte content verification as defense-in-depth
  - Mock virus scan step
  - Pre-signed URL generation and file metadata storage
  - Returns `201` with `id`, `fileName`, `mimeType`, `size`, `presignedUrl`, `uploadedAt`

- **`routes-d/tests/kyc.upload.test.ts`** — Route integration tests covering:
  - Successful upload returns 201 with correct metadata
  - Oversized file rejection (413 `FILE_TOO_LARGE`)
  - Unsupported MIME type rejection (415 `UNSUPPORTED_FILE_TYPE`)
  - Missing authentication (401 `UNAUTHORIZED`)
  - Missing file (400 `NO_FILE`)
  - Invalid file content / magic byte mismatch (415 `INVALID_FILE_CONTENT`)
  - Unique file IDs per upload
  - Concurrent upload isolation

## Testing

Tests follow the existing routes-d pattern (`supertest` + `express`, `buildApp()`, `beforeEach` reset, `__seed*` helpers).

```bash
npm test -- routes-d/tests/kyc.upload.test.ts
```

closes #386

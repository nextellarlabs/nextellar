# Avatar API

Endpoints for uploading, serving, and deleting user avatar images.

---

## Endpoints

### POST `/account/avatar`

Upload a user avatar image. The file is resized to all canonical sizes and stored
as PNG. Any EXIF metadata (GPS, camera model, etc.) is stripped before persistence.

**Headers**

| Header       | Required | Description                       |
|--------------|----------|-----------------------------------|
| `x-user-id`  | Yes      | Authenticated user identifier     |

**Body** — `multipart/form-data`

| Field    | Type   | Required | Description                      |
|----------|--------|----------|----------------------------------|
| `avatar` | file   | Yes      | PNG or JPEG, max 5 MB            |

**Canonical output sizes (px):** `32`, `64`, `128`, `256`

**Response `201`**

```json
{
  "success": true,
  "data": {
    "userId": "user-abc",
    "sizes": [32, 64, 128, 256],
    "uploadedAt": "2026-07-25T12:00:00.000Z"
  }
}
```

**Error codes**

| Code              | Status | Description                                    |
|-------------------|--------|------------------------------------------------|
| `UNAUTHORIZED`    | 401    | `x-user-id` header missing                    |
| `NO_FILE`         | 400    | `avatar` field not present in form data       |
| `FILE_TOO_LARGE`  | 413    | File exceeds 5 MB limit                       |
| `UNSUPPORTED_TYPE`| 415    | File is not PNG or JPEG                       |
| `INVALID_IMAGE`   | 422    | File bytes cannot be decoded as a valid image |

---

### GET `/account/avatar`

Fetch a stored avatar variant as a PNG image.

**Headers**

| Header       | Required | Description                       |
|--------------|----------|-----------------------------------|
| `x-user-id`  | Yes      | Authenticated user identifier     |

**Query parameters**

| Parameter | Type   | Required | Default | Allowed values         |
|-----------|--------|----------|---------|------------------------|
| `size`    | number | No       | `128`   | `32`, `64`, `128`, `256` |

**Response `200`**

Binary PNG image (`Content-Type: image/png`).

**Error codes**

| Code              | Status | Description                          |
|-------------------|--------|--------------------------------------|
| `UNAUTHORIZED`    | 401    | `x-user-id` header missing           |
| `INVALID_SIZE`    | 400    | `size` is not one of the allowed values |
| `AVATAR_NOT_FOUND`| 404    | User has no stored avatar            |

---

### DELETE `/account/avatar`

Remove all stored avatar variants for the authenticated user.

**Headers**

| Header       | Required | Description                       |
|--------------|----------|-----------------------------------|
| `x-user-id`  | Yes      | Authenticated user identifier     |

**Response `200`**

```json
{ "success": true }
```

**Error codes**

| Code              | Status | Description                          |
|-------------------|--------|--------------------------------------|
| `UNAUTHORIZED`    | 401    | `x-user-id` header missing           |
| `AVATAR_NOT_FOUND`| 404    | User has no stored avatar            |

---

## Image processing

| Step              | Detail                                                        |
|-------------------|---------------------------------------------------------------|
| Type detection    | Magic-byte sniffing (not client-supplied MIME header)        |
| EXIF stripping    | JPEG APP1 / APP2-APP15 segments removed before processing    |
| Resize algorithm  | Nearest-neighbour, applied independently per target size     |
| Output format     | Always PNG (`image/png`), regardless of input format         |
| Max upload        | 5 MB                                                          |
| Supported input   | `image/png`, `image/jpeg`                                    |

---

## Files

| Path                                                        | Purpose                            |
|-------------------------------------------------------------|------------------------------------|
| `routes-d/routes/account.avatar.ts`                        | Express router (upload/fetch/delete) |
| `routes-d/lib/imageProcessor.ts`                           | Pure-JS resize, EXIF strip, codec |
| `routes-d/tests/account.avatar.test.ts`                    | Route-level supertest suite       |
| `routes-d/tests/unit/imageProcessor.test.ts`               | Unit tests for image processing   |
| `routes-d/tests/integration/account.avatar.integration.test.ts` | End-to-end integration tests |

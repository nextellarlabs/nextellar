# Cursor pagination

`routes-d/lib/pagination.ts` encodes cursor state as `v1.<payload>.<signature>`.

## Payload

The payload is a base64url JSON object with:

- `version`: currently `1`
- `issuedAt`: ISO timestamp for audit and trace correlation
- `sort`: ordered stable sort keys, each with `field`, `direction`, and `value`

Every paginated route should include a unique tie-breaker such as `id` as the final sort key. For example, an activity feed can sort by `createdAt desc` and then `id asc` to avoid duplicate or skipped rows when records share the same timestamp.

## Signature

The signature is an HMAC-SHA256 digest over the encoded payload. Set `ROUTES_D_CURSOR_SECRET` in every deployed environment. The helper rejects cursors with invalid signatures so clients cannot modify sort keys, move backwards to unauthorized ranges, or inject unsupported fields.

## Decode behavior

`decodeCursor` validates the version, signature, and sort definitions before returning the payload. Routes should treat decode failures as a `400 Bad Request` and ask the client to restart pagination without a cursor.

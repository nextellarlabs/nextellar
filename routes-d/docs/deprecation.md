# Deprecation Middleware

The deprecation middleware surfaces deprecation timelines to API clients via standardized HTTP response headers, following RFC 8594 recommendations.

## Features

- **Deprecation Headers**: Emits `Deprecation` and `Sunset` headers per RFC 8594
- **Manifest-Based Configuration**: Configure deprecations via JSON manifest file
- **Usage Logging**: Tracks deprecated endpoint usage for outreach campaigns
- **Hot Reloading**: Automatically reloads manifest changes without server restart
- **Flexible Matching**: Supports exact paths, wildcards, and parameterized routes
- **Method Filtering**: Configure deprecations per HTTP method or use `*` for all methods

## Installation

The deprecation middleware is located at `routes-d/middleware/deprecation.ts` and can be integrated into any Express application.

```typescript
import express from 'express';
import { getDeprecationMiddleware } from './routes-d/middleware/deprecation.js';

const app = express();

// Apply deprecation middleware globally
const deprecation = getDeprecationMiddleware();
app.use(deprecation.middleware());

// Your routes...
app.get('/api/v1/users', (req, res) => {
  res.json({ users: [] });
});
```

## Configuration

### Manifest File

Create a deprecation manifest at `routes-d/config/deprecation-manifest.json`:

```json
{
  "version": "1.0.0",
  "deprecated": [
    {
      "method": "GET",
      "path": "/api/v1/users",
      "deprecation": "true",
      "sunset": "Sun, 01 Jan 2027 00:00:00 GMT",
      "message": "This endpoint is deprecated. Please use /api/v2/users instead.",
      "link": "https://docs.example.com/migrations/v1-to-v2"
    },
    {
      "method": "*",
      "path": "/api/legacy/*",
      "deprecation": "Sat, 01 Mar 2025 00:00:00 GMT",
      "sunset": "Mon, 01 Jun 2026 00:00:00 GMT",
      "message": "Legacy API endpoints are being phased out."
    }
  ]
}
```

### Manifest Schema

Each deprecation entry supports the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | Yes | HTTP method (`GET`, `POST`, etc.) or `*` for all methods |
| `path` | string | Yes | Route path (exact, wildcard `*`, or param-style `:id`) |
| `deprecation` | string | Yes | RFC 8594 Deprecation header value (`true` or HTTP date) |
| `sunset` | string | No | RFC 8594 Sunset header value (HTTP date when endpoint removed) |
| `message` | string | No | Human-readable deprecation message |
| `link` | string | No | URL to migration guide or documentation |

### Path Matching

The middleware supports flexible path matching:

1. **Exact Match**: `/api/v1/users` matches only that exact path
2. **Wildcard**: `/api/legacy/*` matches any path starting with `/api/legacy/`
3. **Parameters**: `/api/users/:id` matches `/api/users/123`, `/api/users/456`, etc.

### Method Matching

- Specific method: `"method": "GET"` matches only GET requests
- All methods: `"method": "*"` matches GET, POST, PUT, DELETE, etc.

## Response Headers

When a deprecated endpoint is accessed, the middleware emits the following headers:

### Standard Headers (RFC 8594)

- **`Deprecation`**: Set to `true` or an HTTP date indicating when deprecation started
- **`Sunset`**: HTTP date indicating when the endpoint will be removed
- **`Link`**: URL to migration guide with `rel="deprecation"`

### Custom Headers

- **`X-Deprecation-Message`**: Human-readable deprecation message

### Example Response

```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sun, 01 Jan 2027 00:00:00 GMT
Link: <https://docs.example.com/migrations/v1-to-v2>; rel="deprecation"
X-Deprecation-Message: This endpoint is deprecated. Please use /api/v2/users instead.
Content-Type: application/json

{
  "users": []
}
```

## Usage Tracking

The middleware logs all accesses to deprecated endpoints for outreach purposes.

### Console Logging

Each access is logged to the console:

```
[DEPRECATION] GET /api/v1/users accessed at 2026-07-26T10:30:00.000Z
```

### Statistics API

Retrieve usage statistics programmatically:

```typescript
const deprecation = getDeprecationMiddleware();

// Get all statistics
const stats = deprecation.getStats();
console.log(stats);
// [
//   {
//     endpoint: '/api/v1/users',
//     method: 'GET',
//     count: 42,
//     lastAccessed: '2026-07-26T10:30:00.000Z'
//   }
// ]

// Clear statistics
deprecation.clearStats();
```

### Outreach Use Case

Use the statistics to identify clients still using deprecated endpoints:

```typescript
import { getDeprecationMiddleware } from './routes-d/middleware/deprecation.js';

const deprecation = getDeprecationMiddleware();

// Daily report of deprecated endpoint usage
setInterval(() => {
  const stats = deprecation.getStats();
  
  stats.forEach(stat => {
    console.log(`Endpoint ${stat.endpoint} (${stat.method}): ${stat.count} requests`);
    console.log(`Last accessed: ${stat.lastAccessed}`);
  });
  
  // Send to monitoring system, email admins, etc.
  // sendDeprecationReport(stats);
  
  // Reset counters for next period
  deprecation.clearStats();
}, 24 * 60 * 60 * 1000); // Daily
```

## Hot Reloading

Enable automatic manifest reloading when the file changes:

```typescript
const deprecation = getDeprecationMiddleware();

// Enable watching (useful in development)
deprecation.watchManifest();

// Disable watching
deprecation.unwatchManifest();

// Manual reload
deprecation.loadManifest();
```

The manifest is checked every 2 seconds for changes. This is useful during development but can be disabled in production.

## Testing

### Unit Tests

Run unit tests with:

```bash
npm test routes-d/tests/unit/deprecation.test.ts
```

Tests cover:
- Manifest loading and reloading
- Header emission for various scenarios
- Path and method matching
- Usage statistics tracking

### Integration Tests

Run integration tests with:

```bash
npm test routes-d/tests/integration/deprecation.integration.test.ts
```

Integration tests verify:
- End-to-end HTTP header responses
- Express middleware integration
- Manifest hot reloading
- Statistics collection across requests

## Best Practices

### 1. Use RFC-Compliant Dates

Always use HTTP date format for `deprecation` and `sunset` values:

```json
{
  "deprecation": "Sat, 01 Mar 2025 00:00:00 GMT",
  "sunset": "Sun, 01 Jun 2025 00:00:00 GMT"
}
```

Or use `"true"` for the `deprecation` header if the deprecation date is not important.

### 2. Provide Migration Paths

Always include:
- A clear `message` explaining what to use instead
- A `link` to migration documentation

### 3. Set Reasonable Sunset Dates

Give clients adequate time to migrate (typically 6-12 months minimum):

```json
{
  "deprecation": "true",
  "sunset": "Sun, 01 Jan 2028 00:00:00 GMT",
  "message": "Migrate to v2 API. See migration guide for details.",
  "link": "https://docs.example.com/migration-v1-to-v2"
}
```

### 4. Monitor Usage

Regularly check statistics to:
- Identify clients still using deprecated endpoints
- Plan outreach campaigns
- Assess when it's safe to remove endpoints

### 5. Coordinate with API Versioning

Align deprecations with API version strategy:

```json
{
  "deprecated": [
    {
      "method": "*",
      "path": "/api/v1/*",
      "deprecation": "true",
      "sunset": "Mon, 01 Jun 2027 00:00:00 GMT",
      "message": "API v1 is deprecated. Please upgrade to v2.",
      "link": "https://docs.example.com/api/v2"
    }
  ]
}
```

## RFC 8594 Compliance

This middleware implements [RFC 8594: The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594.html) and follows deprecation header best practices:

- Uses standardized `Deprecation` header (boolean or date)
- Uses standardized `Sunset` header (HTTP date format)
- Uses `Link` header with `rel="deprecation"` for documentation
- Does not break existing API functionality
- Provides machine-readable and human-readable information

## Troubleshooting

### Manifest Not Loading

If the manifest doesn't load:

1. Check the file path (default: `routes-d/config/deprecation-manifest.json`)
2. Verify JSON syntax is valid
3. Check console for error messages
4. Ensure the file is readable by the Node.js process

### Headers Not Appearing

If deprecation headers don't appear:

1. Verify the manifest loaded successfully (check `getManifest()`)
2. Check path and method matching in the manifest
3. Ensure middleware is registered before routes
4. Verify the request path matches exactly (including leading `/`)

### Statistics Not Tracking

If statistics aren't tracked:

1. Ensure headers are being emitted (check with browser DevTools)
2. Verify `getStats()` is called on the same middleware instance
3. Check if `clearStats()` was called recently

## Examples

### Example 1: Simple Deprecation

```json
{
  "version": "1.0.0",
  "deprecated": [
    {
      "method": "GET",
      "path": "/api/old-endpoint",
      "deprecation": "true",
      "message": "Use /api/new-endpoint instead"
    }
  ]
}
```

### Example 2: Scheduled Sunset

```json
{
  "version": "1.0.0",
  "deprecated": [
    {
      "method": "POST",
      "path": "/api/legacy/create",
      "deprecation": "Sat, 01 Jan 2026 00:00:00 GMT",
      "sunset": "Sun, 01 Jan 2027 00:00:00 GMT",
      "message": "This endpoint will be removed on January 1, 2027",
      "link": "https://docs.example.com/migration"
    }
  ]
}
```

### Example 3: Entire API Version Deprecation

```json
{
  "version": "1.0.0",
  "deprecated": [
    {
      "method": "*",
      "path": "/api/v1/*",
      "deprecation": "true",
      "sunset": "Mon, 01 Jun 2028 00:00:00 GMT",
      "message": "API v1 is deprecated. Please migrate to v2.",
      "link": "https://docs.example.com/api/v2/migration"
    }
  ]
}
```

## API Reference

### `DeprecationMiddleware`

The main middleware class.

#### Constructor

```typescript
constructor(manifestPath?: string)
```

Creates a new deprecation middleware instance.

#### Methods

- **`middleware(): RequestHandler`** - Returns Express middleware function
- **`loadManifest(): boolean`** - Manually reload manifest from disk
- **`watchManifest(): void`** - Enable hot reloading
- **`unwatchManifest(): void`** - Disable hot reloading
- **`getStats(): DeprecationStats[]`** - Get usage statistics
- **`clearStats(): void`** - Clear usage statistics
- **`getManifest(): DeprecationManifest | null`** - Get current manifest

### Helper Functions

- **`getDeprecationMiddleware(manifestPath?: string)`** - Get singleton instance
- **`createDeprecationMiddleware(manifestPath?: string)`** - Create new instance (for testing)

## License

MIT

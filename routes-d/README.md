# Routes-D: Deprecation Middleware

This directory contains the implementation of the API deprecation middleware system for the Nextellar project.

## Overview

The deprecation middleware automatically surfaces deprecation timelines to API clients via HTTP response headers, following RFC 8594 standards. This allows graceful API evolution with clear communication to clients about deprecated endpoints and their sunset dates.

## Structure

```
routes-d/
├── config/
│   └── deprecation-manifest.json    # Deprecation configuration
├── docs/
│   └── deprecation.md               # Full documentation
├── lib/
│   ├── exampleApp.ts                # Example Express integration
│   └── response.ts                  # Response utilities
├── middleware/
│   ├── deprecation.ts               # Main deprecation middleware
│   └── errorHandler.ts              # Error handling
├── routes/
│   └── example.deprecated.ts        # Example deprecated route
└── tests/
    ├── unit/
    │   └── deprecation.test.ts      # Unit tests
    └── integration/
        └── deprecation.integration.test.ts  # Integration tests
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Deprecations

Edit `routes-d/config/deprecation-manifest.json`:

```json
{
  "version": "1.0.0",
  "deprecated": [
    {
      "method": "GET",
      "path": "/api/v1/users",
      "deprecation": "true",
      "sunset": "Sun, 01 Jan 2027 00:00:00 GMT",
      "message": "Use /api/v2/users instead",
      "link": "https://docs.example.com/migration"
    }
  ]
}
```

### 3. Integrate Middleware

```typescript
import express from 'express';
import { getDeprecationMiddleware } from './routes-d/middleware/deprecation.js';

const app = express();

// Apply deprecation middleware globally
const deprecation = getDeprecationMiddleware();
app.use(deprecation.middleware());

// Your routes...
app.listen(3000);
```

### 4. Test It

```bash
# Run unit tests
npm test routes-d/tests/unit/deprecation.test.ts

# Run integration tests
npm test routes-d/tests/integration/deprecation.integration.test.ts

# Run all tests
npm test
```

## Features

✅ **RFC 8594 Compliant**: Emits standard `Deprecation` and `Sunset` headers  
✅ **Manifest-Based**: Configure all deprecations in one JSON file  
✅ **Hot Reloading**: Automatically reloads configuration changes  
✅ **Usage Tracking**: Logs deprecated endpoint usage for outreach  
✅ **Flexible Matching**: Supports exact paths, wildcards, and parameters  
✅ **Method Filtering**: Configure per HTTP method or use `*` for all  
✅ **Zero Impact**: Does not modify response body or break existing functionality  
✅ **Well Tested**: Comprehensive unit and integration tests  

## Response Headers

When a client accesses a deprecated endpoint, they receive:

```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sun, 01 Jan 2027 00:00:00 GMT
Link: <https://docs.example.com/migration>; rel="deprecation"
X-Deprecation-Message: Use /api/v2/users instead
Content-Type: application/json

{
  "users": []
}
```

## Usage Statistics

Track which clients are using deprecated endpoints:

```typescript
const deprecation = getDeprecationMiddleware();

// Get usage statistics
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

## Configuration Reference

### Manifest Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | Yes | HTTP method or `*` for all |
| `path` | string | Yes | Route path (exact, wildcard, or parameterized) |
| `deprecation` | string | Yes | `"true"` or HTTP date |
| `sunset` | string | No | HTTP date of removal |
| `message` | string | No | Human-readable message |
| `link` | string | No | URL to migration guide |

### Path Patterns

- **Exact**: `/api/v1/users` - matches exactly
- **Wildcard**: `/api/legacy/*` - matches anything starting with `/api/legacy/`
- **Parameters**: `/api/users/:id` - matches `/api/users/123`, etc.

## Testing

Run the test suite:

```bash
# All tests
npm test

# Unit tests only
npm test routes-d/tests/unit/

# Integration tests only
npm test routes-d/tests/integration/

# Watch mode
npm test -- --watch
```

## Documentation

Full documentation is available in [`docs/deprecation.md`](./docs/deprecation.md), including:

- Complete API reference
- RFC 8594 compliance details
- Best practices
- Troubleshooting guide
- Usage examples

## Examples

### Example 1: Basic Setup

See [`lib/exampleApp.ts`](./lib/exampleApp.ts) for a complete Express application with deprecation middleware.

### Example 2: Deprecated Route

See [`routes/example.deprecated.ts`](./routes/example.deprecated.ts) for example deprecated endpoints.

### Example 3: Admin Endpoints

The example app includes admin endpoints for monitoring:

- `GET /admin/deprecation-stats` - View usage statistics
- `POST /admin/deprecation-stats/clear` - Clear statistics
- `POST /admin/deprecation-manifest/reload` - Reload manifest

## Best Practices

1. **Plan Ahead**: Set sunset dates 6-12 months in the future
2. **Provide Migration Paths**: Always include `message` and `link` fields
3. **Monitor Usage**: Regularly check statistics to identify clients needing support
4. **Communicate Early**: Announce deprecations well before the sunset date
5. **Be Consistent**: Use RFC 8594 date format for all dates

## RFC 8594 Compliance

This implementation follows [RFC 8594: The Sunset HTTP Header Field](https://www.rfc-editor.org/rfc/rfc8594.html):

- ✅ Uses standardized `Deprecation` header
- ✅ Uses standardized `Sunset` header with HTTP date format
- ✅ Uses `Link` header with `rel="deprecation"`
- ✅ Does not break existing functionality
- ✅ Provides machine-readable and human-readable information

## Contributing

When adding features to the deprecation system:

1. Add tests to `tests/unit/` and `tests/integration/`
2. Update documentation in `docs/deprecation.md`
3. Ensure all tests pass: `npm test`
4. Follow TypeScript and ESM conventions

## License

MIT

## Support

For issues, questions, or contributions, please refer to the main Nextellar repository.

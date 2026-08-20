# In-App Notification Feed (`routes-d`)

This module surfaces an authenticated in-app notification feed endpoint for the Nextellar client. It provides paginated views for unread and read notifications, single & batch mark-as-read handlers, and automatic retention window pruning.

## Base Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/notifications/feed` | Fetch paginated notification feed (`all`, `unread`, `read`) |
| `PATCH` / `POST` | `/notifications/:id/read` | Mark a specific notification as read |
| `PATCH` / `POST` | `/notifications/read-all` | Mark all unread notifications for the user as read |
| `POST` | `/notifications` | Dispatch/create a new notification |

## Authentication

All endpoints require authentication:
- `x-user-id` header (e.g. `x-user-id: user_123`) OR
- `Authorization: Bearer <user_id>`

Unauthenticated requests return `401 Unauthorized`.

## Query Parameters (`GET /notifications/feed`)

- `status`: `'all'` | `'unread'` | `'read'` (default: `'all'`)
- `page`: Page number (default: `1`)
- `limit`: Items per page (default: `10`, max: `100`)
- `retentionDays`: Configurable retention pruning window in days (default: `30`)

## Retention Pruning

Notifications older than `retentionDays` are automatically pruned prior to returning feed query results. Retention settings can also be updated globally or per query request.

## Example Response

```json
{
  "success": true,
  "data": [
    {
      "id": "notif_1720000000_abc123",
      "userId": "user_123",
      "title": "Payment Received",
      "message": "You received 500 XLM",
      "type": "transaction",
      "read": false,
      "createdAt": "2026-07-25T12:00:00.000Z",
      "readAt": null
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1,
    "unreadCount": 1
  }
}
```

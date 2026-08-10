import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

export interface NotificationEvent {
  id: number;
  userId: string;
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface WaitingPollClient {
  userId: string;
  cursor: number;
  res: Response;
  timer: NodeJS.Timeout;
  resolved: boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 100;

const userNotifications = new Map<string, NotificationEvent[]>();
const waitingPolls = new Map<string, Set<WaitingPollClient>>();

let globalEventIdCounter = 1;

export function __seedNotification(evt: Omit<NotificationEvent, "id"> & { id?: number }): NotificationEvent {
  const id = evt.id ?? globalEventIdCounter++;
  const fullEvt: NotificationEvent = { ...evt, id };

  if (!userNotifications.has(evt.userId)) {
    userNotifications.set(evt.userId, []);
  }
  userNotifications.get(evt.userId)!.push(fullEvt);
  return fullEvt;
}

export function __publishNotification(
  userId: string,
  evtData: Omit<NotificationEvent, "id" | "userId" | "createdAt">,
): NotificationEvent {
  const evt = __seedNotification({
    userId,
    ...evtData,
    createdAt: new Date().toISOString(),
  });

  const waiters = waitingPolls.get(userId);
  if (waiters && waiters.size > 0) {
    for (const client of Array.from(waiters)) {
      if (client.resolved) continue;

      const events = getEventsAfterCursor(userId, client.cursor);
      if (events.length > 0) {
        clearTimeout(client.timer);
        client.resolved = true;
        waiters.delete(client);

        const nextCursor = events[events.length - 1].id;
        client.res.status(200).json({
          success: true,
          data: {
            events,
            cursor: nextCursor,
            count: events.length,
            timeout: false,
          },
        });
      }
    }
  }

  return evt;
}

export function __resetNotifications(): void {
  for (const set of waitingPolls.values()) {
    for (const client of set) {
      clearTimeout(client.timer);
      if (!client.resolved) {
        client.resolved = true;
        try {
          client.res.status(200).json({
            success: true,
            data: { events: [], cursor: client.cursor, count: 0, timeout: true },
          });
        } catch {
          // ignore
        }
      }
    }
  }
  waitingPolls.clear();
  userNotifications.clear();
  globalEventIdCounter = 1;
}

function getEventsAfterCursor(userId: string, cursor: number): NotificationEvent[] {
  const list = userNotifications.get(userId) || [];
  return list.filter((e) => e.id > cursor);
}

/**
 * GET /notifications/poll & GET /notifications/longpoll
 * Cursor-based long-polling endpoint for notifications.
 * Query params:
 *   - cursor: number (default: 0)
 *   - timeoutMs / timeout: number (bounded 100ms - 30000ms, default: 5000ms)
 */
async function handleLongPoll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.headers["x-user-id"] as string | undefined;
    if (!userId) {
      sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
      return;
    }

    const cursorStr = (req.query.cursor as string) || "0";
    const cursor = parseInt(cursorStr, 10);
    if (isNaN(cursor) || cursor < 0) {
      sendError(res, "BAD_REQUEST", "cursor must be a non-negative integer", 400);
      return;
    }

    const timeoutQuery = (req.query.timeoutMs as string) || (req.query.timeout as string);
    let timeoutMs = timeoutQuery ? parseInt(timeoutQuery, 10) : DEFAULT_TIMEOUT_MS;
    if (isNaN(timeoutMs)) {
      timeoutMs = DEFAULT_TIMEOUT_MS;
    }
    timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, timeoutMs));

    // Check immediate return if events exist after cursor
    const existingEvents = getEventsAfterCursor(userId, cursor);
    if (existingEvents.length > 0) {
      const nextCursor = existingEvents[existingEvents.length - 1].id;
      res.status(200).json({
        success: true,
        data: {
          events: existingEvents,
          cursor: nextCursor,
          count: existingEvents.length,
          timeout: false,
        },
      });
      return;
    }

    if (!waitingPolls.has(userId)) {
      waitingPolls.set(userId, new Set());
    }

    const userWaiters = waitingPolls.get(userId)!;

    let resolved = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      userWaiters.delete(waiterObj);

      res.status(200).json({
        success: true,
        data: {
          events: [],
          cursor,
          count: 0,
          timeout: true,
        },
      });
    }, timeoutMs);

    const waiterObj: WaitingPollClient = {
      userId,
      cursor,
      res,
      timer,
      resolved: false,
    };

    userWaiters.add(waiterObj);

    req.on("close", () => {
      if (!waiterObj.resolved) {
        waiterObj.resolved = true;
        clearTimeout(timer);
        userWaiters.delete(waiterObj);
      }
    });
  } catch (err) {
    return next(err);
  }
}

router.get("/notifications/poll", handleLongPoll);
router.get("/notifications/longpoll", handleLongPoll);

export default router;
export { userNotifications, waitingPolls };

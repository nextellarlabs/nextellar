/**
 * Notification Store & Management Service
 * Provides in-memory state management, pagination, mark-read handlers, and retention pruning.
 */

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type?: string;
  read: boolean;
  createdAt: string;
  readAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NotificationFeedOptions {
  status?: 'all' | 'unread' | 'read';
  page?: number;
  limit?: number;
  retentionDays?: number;
}

export interface PaginatedNotifications {
  items: Notification[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  unreadCount: number;
}

// Global in-memory notifications collection
const notificationsStore: Notification[] = [];
let globalRetentionDays = 30;

/**
 * Configure default global retention window in days.
 */
export function setGlobalRetentionDays(days: number): void {
  if (days <= 0) {
    throw new Error('Retention days must be a positive number');
  }
  globalRetentionDays = days;
}

/**
 * Get current global retention window in days.
 */
export function getGlobalRetentionDays(): number {
  return globalRetentionDays;
}

/**
 * Remove notifications older than retention window.
 */
export function pruneNotifications(userId?: string, retentionDays?: number): { prunedCount: number } {
  const days = retentionDays ?? globalRetentionDays;
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

  let prunedCount = 0;
  for (let i = notificationsStore.length - 1; i >= 0; i--) {
    const item = notificationsStore[i];
    const createdTimestamp = new Date(item.createdAt).getTime();

    if (createdTimestamp < cutoffTime) {
      if (!userId || item.userId === userId) {
        notificationsStore.splice(i, 1);
        prunedCount++;
      }
    }
  }

  return { prunedCount };
}

/**
 * Create a new notification for a target user.
 */
export function createNotification(params: {
  userId: string;
  title: string;
  message: string;
  type?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): Notification {
  const newNotification: Notification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    userId: params.userId,
    title: params.title,
    message: params.message,
    type: params.type || 'info',
    read: false,
    createdAt: params.createdAt || new Date().toISOString(),
    readAt: null,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };

  notificationsStore.unshift(newNotification);
  return newNotification;
}

/**
 * Fetch paginated notification feed for a user with status filtering and auto retention pruning.
 */
export function getNotificationFeed(
  userId: string,
  options: NotificationFeedOptions = {}
): PaginatedNotifications {
  const retentionDays = options.retentionDays ?? globalRetentionDays;
  pruneNotifications(userId, retentionDays);

  const status = options.status || 'all';
  const rawPage = Number(options.page) || 1;
  const rawLimit = Number(options.limit) || 10;

  const page = Math.max(1, rawPage);
  const limit = Math.min(100, Math.max(1, rawLimit));

  const userNotifications = notificationsStore.filter((n) => n.userId === userId);
  const unreadCount = userNotifications.filter((n) => !n.read).length;

  let filtered = userNotifications;
  if (status === 'unread') {
    filtered = userNotifications.filter((n) => !n.read);
  } else if (status === 'read') {
    filtered = userNotifications.filter((n) => n.read);
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const startIndex = (page - 1) * limit;
  const items = filtered.slice(startIndex, startIndex + limit);

  return {
    items,
    total,
    page,
    limit,
    totalPages,
    unreadCount,
  };
}

/**
 * Mark a single notification as read.
 */
export function markNotificationAsRead(userId: string, notificationId: string): Notification | null {
  const notification = notificationsStore.find((n) => n.id === notificationId && n.userId === userId);

  if (!notification) {
    return null;
  }

  if (!notification.read) {
    notification.read = true;
    notification.readAt = new Date().toISOString();
  }

  return notification;
}

/**
 * Mark all unread notifications for a user as read.
 */
export function markAllNotificationsAsRead(userId: string): { updatedCount: number } {
  let updatedCount = 0;
  const nowIso = new Date().toISOString();

  for (const n of notificationsStore) {
    if (n.userId === userId && !n.read) {
      n.read = true;
      n.readAt = nowIso;
      updatedCount++;
    }
  }

  return { updatedCount };
}

/**
 * Test Helper: Reset the store.
 */
export function __resetNotificationsStore(): void {
  notificationsStore.length = 0;
  globalRetentionDays = 30;
}

/**
 * Test Helper: Seed notifications into store.
 */
export function __seedNotifications(items: Notification[]): void {
  notificationsStore.push(...items);
}

/**
 * Test Helper: Get all store contents.
 */
export function __getNotificationsStore(): Notification[] {
  return notificationsStore;
}

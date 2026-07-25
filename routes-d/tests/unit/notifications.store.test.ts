import {
  createNotification,
  getNotificationFeed,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  pruneNotifications,
  setGlobalRetentionDays,
  getGlobalRetentionDays,
  __resetNotificationsStore,
  __seedNotifications,
  Notification,
} from "../../lib/notificationsStore.js";

describe("notificationsStore Unit Tests", () => {
  beforeEach(() => {
    __resetNotificationsStore();
  });

  describe("createNotification & getNotificationFeed", () => {
    it("creates a notification and retrieves it in user feed", () => {
      const notif = createNotification({
        userId: "user-1",
        title: "Test Title",
        message: "Test Message",
        type: "info",
      });

      expect(notif.id).toBeDefined();
      expect(notif.read).toBe(false);
      expect(notif.readAt).toBeNull();

      const feed = getNotificationFeed("user-1");
      expect(feed.total).toBe(1);
      expect(feed.unreadCount).toBe(1);
      expect(feed.items[0].id).toBe(notif.id);
    });

    it("isolates notifications by userId", () => {
      createNotification({ userId: "user-1", title: "User 1 Notif", message: "M1" });
      createNotification({ userId: "user-2", title: "User 2 Notif", message: "M2" });

      const feed1 = getNotificationFeed("user-1");
      const feed2 = getNotificationFeed("user-2");

      expect(feed1.total).toBe(1);
      expect(feed1.items[0].userId).toBe("user-1");
      expect(feed2.total).toBe(1);
      expect(feed2.items[0].userId).toBe("user-2");
    });
  });

  describe("Pagination & Status Filtering", () => {
    beforeEach(() => {
      for (let i = 1; i <= 25; i++) {
        __seedNotifications([
          {
            id: `notif-${i}`,
            userId: "user-paginate",
            title: `Notification ${i}`,
            message: `Message ${i}`,
            read: i % 2 === 0, // Even numbers read, odd unread
            createdAt: new Date(Date.now() - (25 - i) * 1000).toISOString(),
            readAt: i % 2 === 0 ? new Date().toISOString() : null,
          },
        ]);
      }
    });

    it("paginates notifications feed correctly", () => {
      const page1 = getNotificationFeed("user-paginate", { page: 1, limit: 10 });
      expect(page1.items.length).toBe(10);
      expect(page1.total).toBe(25);
      expect(page1.totalPages).toBe(3);
      expect(page1.page).toBe(1);

      const page3 = getNotificationFeed("user-paginate", { page: 3, limit: 10 });
      expect(page3.items.length).toBe(5);
      expect(page3.page).toBe(3);
    });

    it("filters feed by status=unread", () => {
      const unreadFeed = getNotificationFeed("user-paginate", { status: "unread" });
      expect(unreadFeed.items.every((n) => !n.read)).toBe(true);
      expect(unreadFeed.total).toBe(13); // 13 odd numbers between 1 and 25
    });

    it("filters feed by status=read", () => {
      const readFeed = getNotificationFeed("user-paginate", { status: "read" });
      expect(readFeed.items.every((n) => n.read)).toBe(true);
      expect(readFeed.total).toBe(12); // 12 even numbers between 1 and 25
    });
  });

  describe("Mark as Read handlers", () => {
    it("marks single notification as read", () => {
      const notif = createNotification({
        userId: "user-read",
        title: "To Read",
        message: "Read me",
      });

      expect(notif.read).toBe(false);

      const updated = markNotificationAsRead("user-read", notif.id);
      expect(updated).not.toBeNull();
      expect(updated?.read).toBe(true);
      expect(updated?.readAt).toBeDefined();

      const feed = getNotificationFeed("user-read");
      expect(feed.unreadCount).toBe(0);
    });

    it("returns null when marking non-existent or other user notification", () => {
      createNotification({ userId: "user-a", title: "A", message: "A" });
      const result = markNotificationAsRead("user-b", "nonexistent-id");
      expect(result).toBeNull();
    });

    it("marks all notifications as read for a user", () => {
      createNotification({ userId: "user-all", title: "1", message: "1" });
      createNotification({ userId: "user-all", title: "2", message: "2" });
      createNotification({ userId: "user-other", title: "3", message: "3" });

      const result = markAllNotificationsAsRead("user-all");
      expect(result.updatedCount).toBe(2);

      const feedAll = getNotificationFeed("user-all");
      expect(feedAll.unreadCount).toBe(0);

      const feedOther = getNotificationFeed("user-other");
      expect(feedOther.unreadCount).toBe(1);
    });
  });

  describe("Retention Window Pruning", () => {
    it("prunes notifications created older than retention days cutoff", () => {
      const now = Date.now();
      const fortyDaysAgo = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString();
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();

      __seedNotifications([
        {
          id: "old-1",
          userId: "user-prune",
          title: "Old",
          message: "Old",
          read: false,
          createdAt: fortyDaysAgo,
        },
        {
          id: "recent-1",
          userId: "user-prune",
          title: "Recent",
          message: "Recent",
          read: false,
          createdAt: tenDaysAgo,
        },
      ]);

      const pruneResult = pruneNotifications("user-prune", 30);
      expect(pruneResult.prunedCount).toBe(1);

      const feed = getNotificationFeed("user-prune", { retentionDays: 30 });
      expect(feed.total).toBe(1);
      expect(feed.items[0].id).toBe("recent-1");
    });

    it("allows configuring global retention days", () => {
      setGlobalRetentionDays(15);
      expect(getGlobalRetentionDays()).toBe(15);

      expect(() => setGlobalRetentionDays(0)).toThrow();
    });
  });
});

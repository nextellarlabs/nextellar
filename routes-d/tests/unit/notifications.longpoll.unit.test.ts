import {
  __seedNotification,
  __publishNotification,
  __resetNotifications,
  userNotifications,
} from "../../routes/notifications.longpoll.js";

describe("Unit: notifications long-poll helpers", () => {
  beforeEach(() => {
    __resetNotifications();
  });

  it("seeds notifications with incremental IDs", () => {
    const e1 = __seedNotification({
      userId: "user-1",
      type: "info",
      title: "Title 1",
      message: "Msg 1",
      createdAt: "2024-06-01T10:00:00Z",
    });

    const e2 = __seedNotification({
      userId: "user-1",
      type: "warning",
      title: "Title 2",
      message: "Msg 2",
      createdAt: "2024-06-01T10:01:00Z",
    });

    expect(e1.id).toBe(1);
    expect(e2.id).toBe(2);
    expect(userNotifications.get("user-1")?.length).toBe(2);
  });

  it("coalesces multiple published notifications for a user", () => {
    __publishNotification("user-2", {
      type: "order",
      title: "Order Placed",
      message: "Order #1 created",
    });

    __publishNotification("user-2", {
      type: "order",
      title: "Order Filled",
      message: "Order #1 filled",
    });

    const list = userNotifications.get("user-2") || [];
    expect(list.length).toBe(2);
    expect(list[0].title).toBe("Order Placed");
    expect(list[1].title).toBe("Order Filled");
  });

  it("resets notifications store completely", () => {
    __seedNotification({
      userId: "user-1",
      type: "info",
      title: "Title",
      message: "Msg",
      createdAt: "2024-06-01T10:00:00Z",
    });

    expect(userNotifications.size).toBe(1);
    __resetNotifications();
    expect(userNotifications.size).toBe(0);
  });
});

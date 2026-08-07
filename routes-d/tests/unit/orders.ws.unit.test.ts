import { EventEmitter } from "node:events";
import {
  OrderWebSocketServer,
  IWebSocket,
  WS_READY_STATE,
  Order,
} from "../../routes/orders.ws.js";

class MockWebSocket extends EventEmitter implements IWebSocket {
  public readyState: number = WS_READY_STATE.OPEN;
  public sentMessages: string[] = [];
  public closedCode?: number;
  public closedReason?: string;
  public bufferedAmount: number = 0;

  public send(data: string): void {
    if (this.readyState !== WS_READY_STATE.OPEN) {
      throw new Error("Socket is not open");
    }
    this.sentMessages.push(data);
  }

  public close(code?: number, reason?: string): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this.closedCode = code;
    this.closedReason = reason;
    this.emit("close", code, reason);
  }

  public ping(): void {
    this.emit("ping");
  }

  public receiveMessage(obj: unknown): void {
    this.emit("message", JSON.stringify(obj));
  }

  public respondPong(): void {
    this.emit("pong");
  }

  public getLastMessage<T = any>(): T | undefined {
    if (this.sentMessages.length === 0) return undefined;
    return JSON.parse(this.sentMessages[this.sentMessages.length - 1]);
  }
}

describe("Unit: OrderWebSocketServer", () => {
  let server: OrderWebSocketServer;

  beforeEach(() => {
    server = new OrderWebSocketServer({
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 200,
      maxQueueSize: 3,
    });
  });

  afterEach(() => {
    server.resetServer();
  });

  // --- Auth Handshake ---

  describe("Authentication Handshake", () => {
    it("authenticates via initial token parameter", () => {
      const socket = new MockWebSocket();
      const session = server.handleConnection(socket, "token-user-123");

      expect(session.authenticated).toBe(true);
      expect(session.userId).toBe("user-123");

      const lastMsg = socket.getLastMessage();
      expect(lastMsg.type).toBe("auth_success");
      expect(lastMsg.userId).toBe("user-123");
    });

    it("authenticates via auth message token after connection", () => {
      const socket = new MockWebSocket();
      const session = server.handleConnection(socket);

      expect(session.authenticated).toBe(false);

      socket.receiveMessage({ type: "auth", token: "token-user-123" });

      expect(session.authenticated).toBe(true);
      expect(socket.getLastMessage().type).toBe("auth_success");
    });

    it("rejects invalid token and closes connection with 4001", () => {
      const socket = new MockWebSocket();
      server.handleConnection(socket, "invalid-token-xyz");

      expect(socket.closedCode).toBe(4001);
      expect(socket.getLastMessage().type).toBe("error");
      expect(socket.getLastMessage().code).toBe("UNAUTHORIZED");
    });
  });

  // --- Subscription ---

  describe("Subscriptions", () => {
    it("subscribes to an order owned by the user", () => {
      const socket = new MockWebSocket();
      const session = server.handleConnection(socket, "token-user-123");

      socket.receiveMessage({ type: "subscribe", orderId: "ord-1001" });

      expect(session.subscriptions.has("ord-1001")).toBe(true);
      expect(socket.getLastMessage().type).toBe("subscribed");
      expect(socket.getLastMessage().orderId).toBe("ord-1001");
    });

    it("rejects subscription to non-existent order with NOT_FOUND", () => {
      const socket = new MockWebSocket();
      server.handleConnection(socket, "token-user-123");

      socket.receiveMessage({ type: "subscribe", orderId: "ord-9999" });

      expect(socket.getLastMessage().type).toBe("error");
      expect(socket.getLastMessage().code).toBe("NOT_FOUND");
    });

    it("rejects subscription to order owned by another user with FORBIDDEN", () => {
      const socket = new MockWebSocket();
      server.handleConnection(socket, "token-user-456");

      // ord-1001 belongs to user-123
      socket.receiveMessage({ type: "subscribe", orderId: "ord-1001" });

      expect(socket.getLastMessage().type).toBe("error");
      expect(socket.getLastMessage().code).toBe("FORBIDDEN");
    });

    it("unsubscribes from an order", () => {
      const socket = new MockWebSocket();
      const session = server.handleConnection(socket, "token-user-123");

      socket.receiveMessage({ type: "subscribe", orderId: "ord-1001" });
      expect(session.subscriptions.has("ord-1001")).toBe(true);

      socket.receiveMessage({ type: "unsubscribe", orderId: "ord-1001" });
      expect(session.subscriptions.has("ord-1001")).toBe(false);
      expect(socket.getLastMessage().type).toBe("unsubscribed");
    });
  });

  // --- Order Updates & Backpressure ---

  describe("Publishing & Backpressure", () => {
    it("publishes order status update to subscribed clients", () => {
      const socket = new MockWebSocket();
      server.handleConnection(socket, "token-user-123");
      socket.receiveMessage({ type: "subscribe", orderId: "ord-1001" });

      server.publishOrderUpdate("ord-1001", "filled", { price: 0.125 });

      const lastMsg = socket.getLastMessage();
      expect(lastMsg.type).toBe("order_update");
      expect(lastMsg.orderId).toBe("ord-1001");
      expect(lastMsg.status).toBe("filled");
    });

    it("triggers backpressure warning when client queue/buffer overflows", () => {
      const socket = new MockWebSocket();
      const session = server.handleConnection(socket, "token-user-123");
      socket.receiveMessage({ type: "subscribe", orderId: "ord-1001" });

      // Simulate full pending queue to trigger backpressure
      session.pendingQueue = ["msg1", "msg2", "msg3"]; // maxQueueSize = 3

      let backpressureEmitted = false;
      server.on("backpressure", () => {
        backpressureEmitted = true;
      });

      server.publishOrderUpdate("ord-1001", "partially_filled");

      expect(backpressureEmitted).toBe(true);
      expect(socket.getLastMessage().type).toBe("backpressure_warning");
    });
  });

  // --- Heartbeat & Timeout Disconnect ---

  describe("Heartbeat & Timeout Disconnect", () => {
    it("maintains connection when client responds to pong", () => {
      const socket = new MockWebSocket();
      const session = server.handleConnection(socket, "token-user-123");

      // First tick sends ping
      server.checkHeartbeats();
      expect(session.isAlive).toBe(false);

      // Client responds with pong
      socket.respondPong();
      expect(session.isAlive).toBe(true);

      // Next tick checks heartbeat -> stays connected
      server.checkHeartbeats();
      expect(socket.readyState).toBe(WS_READY_STATE.OPEN);
    });

    it("disconnects dead connection on heartbeat timeout with code 4000", () => {
      const socket = new MockWebSocket();
      server.handleConnection(socket, "token-user-123");

      let timeoutDisconnectEmitted = false;
      server.on("timeout_disconnect", () => {
        timeoutDisconnectEmitted = true;
      });

      // Tick 1: sets isAlive = false and sends ping
      server.checkHeartbeats();

      // Client does NOT respond with pong!

      // Tick 2: detects dead connection and closes with 4000
      server.checkHeartbeats();

      expect(timeoutDisconnectEmitted).toBe(true);
      expect(socket.readyState).toBe(WS_READY_STATE.CLOSED);
      expect(socket.closedCode).toBe(4000);
    });
  });
});

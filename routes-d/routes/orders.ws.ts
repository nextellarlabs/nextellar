import { EventEmitter } from "node:events";

export interface Order {
  id: string;
  userId: string;
  pair: string;
  side: "buy" | "sell";
  price: number;
  amount: number;
  status: "open" | "partially_filled" | "filled" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface IWebSocket {
  readyState: number; // 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): void;
  ping?(): void;
  bufferedAmount?: number;
}

export interface ClientSession {
  id: string;
  socket: IWebSocket;
  userId?: string;
  authenticated: boolean;
  isAlive: boolean;
  subscriptions: Set<string>;
  pendingQueue: string[];
  maxQueueSize: number;
}

export interface ServerOptions {
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxQueueSize?: number;
}

export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export class OrderWebSocketServer extends EventEmitter {
  private orders = new Map<string, Order>();
  private clients = new Map<string, ClientSession>();
  private orderSubscriptions = new Map<string, Set<ClientSession>>();
  private heartbeatIntervalTimer: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs: number;
  private heartbeatTimeoutMs: number;
  private maxQueueSize: number;
  private validTokens = new Map<string, string>();

  constructor(options: ServerOptions = {}) {
    super();
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 10000;
    this.maxQueueSize = options.maxQueueSize ?? 20;

    // Seed default valid auth tokens
    this.validTokens.set("token-user-123", "user-123");
    this.validTokens.set("token-user-456", "user-456");

    // Seed default order
    const defaultOrder: Order = {
      id: "ord-1001",
      userId: "user-123",
      pair: "XLM/USDC",
      side: "buy",
      price: 0.12,
      amount: 1000,
      status: "open",
      createdAt: "2024-06-01T10:00:00Z",
      updatedAt: "2024-06-01T10:00:00Z",
    };
    this.orders.set(defaultOrder.id, defaultOrder);
  }

  public registerAuthToken(token: string, userId: string): void {
    this.validTokens.set(token, userId);
  }

  public seedOrder(order: Order): void {
    this.orders.set(order.id, { ...order });
  }

  public resetOrders(): void {
    this.orders.clear();
  }

  public resetServer(): void {
    this.stopHeartbeat();
    for (const client of this.clients.values()) {
      try {
        client.socket.close(1000, "Server shutdown");
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.orderSubscriptions.clear();
    this.orders.clear();
  }

  /**
   * Handles a new incoming WebSocket connection.
   */
  public handleConnection(socket: IWebSocket, initialToken?: string): ClientSession {
    const clientId = `client-${Math.random().toString(36).substring(2, 9)}`;
    const session: ClientSession = {
      id: clientId,
      socket,
      authenticated: false,
      isAlive: true,
      subscriptions: new Set(),
      pendingQueue: [],
      maxQueueSize: this.maxQueueSize,
    };

    this.clients.set(clientId, session);

    // If initial token provided via header/query, authenticate immediately
    if (initialToken) {
      this.authenticateClient(session, initialToken);
    }

    socket.on("message", (raw: string | Buffer) => {
      this.handleClientMessage(session, raw.toString("utf8"));
    });

    socket.on("pong", () => {
      session.isAlive = true;
    });

    socket.on("close", () => {
      this.removeClient(session);
    });

    socket.on("error", () => {
      this.removeClient(session);
    });

    return session;
  }

  public authenticateClient(session: ClientSession, token: string): boolean {
    const userId = this.validTokens.get(token) || (token.startsWith("user-") ? token : undefined);
    if (userId) {
      session.authenticated = true;
      session.userId = userId;
      this.sendToClient(session, {
        type: "auth_success",
        userId,
      });
      return true;
    } else {
      this.sendToClient(session, {
        type: "error",
        code: "UNAUTHORIZED",
        message: "Invalid authentication token",
      });
      session.socket.close(4001, "Unauthorized");
      this.removeClient(session);
      return false;
    }
  }

  public handleClientMessage(session: ClientSession, messageStr: string): void {
    let msg: any;
    try {
      msg = JSON.parse(messageStr);
    } catch {
      this.sendToClient(session, {
        type: "error",
        code: "BAD_REQUEST",
        message: "Invalid JSON format",
      });
      return;
    }

    if (!msg || typeof msg !== "object") {
      return;
    }

    switch (msg.type) {
      case "auth":
        this.authenticateClient(session, msg.token);
        break;

      case "pong":
        session.isAlive = true;
        break;

      case "subscribe":
        if (!session.authenticated) {
          this.sendToClient(session, {
            type: "error",
            code: "UNAUTHORIZED",
            message: "Must authenticate before subscribing",
          });
          return;
        }
        this.subscribeClient(session, msg.orderId);
        break;

      case "unsubscribe":
        if (!session.authenticated) {
          return;
        }
        this.unsubscribeClient(session, msg.orderId);
        break;

      default:
        this.sendToClient(session, {
          type: "error",
          code: "UNKNOWN_ACTION",
          message: `Unknown action type: ${msg.type}`,
        });
        break;
    }
  }

  public subscribeClient(session: ClientSession, orderId: string): void {
    if (!orderId) {
      this.sendToClient(session, {
        type: "error",
        code: "BAD_REQUEST",
        message: "orderId is required",
      });
      return;
    }

    const order = this.orders.get(orderId);
    if (!order) {
      this.sendToClient(session, {
        type: "error",
        code: "NOT_FOUND",
        message: `Order not found: ${orderId}`,
      });
      return;
    }

    if (order.userId !== session.userId) {
      this.sendToClient(session, {
        type: "error",
        code: "FORBIDDEN",
        message: "You do not have access to this order",
      });
      return;
    }

    session.subscriptions.add(orderId);

    if (!this.orderSubscriptions.has(orderId)) {
      this.orderSubscriptions.set(orderId, new Set());
    }
    this.orderSubscriptions.get(orderId)!.add(session);

    this.sendToClient(session, {
      type: "subscribed",
      orderId,
      order,
    });
  }

  public unsubscribeClient(session: ClientSession, orderId: string): void {
    session.subscriptions.delete(orderId);
    const subs = this.orderSubscriptions.get(orderId);
    if (subs) {
      subs.delete(session);
      if (subs.size === 0) {
        this.orderSubscriptions.delete(orderId);
      }
    }

    this.sendToClient(session, {
      type: "unsubscribed",
      orderId,
    });
  }

  /**
   * Pushes an order status update to all subscribed authenticated clients.
   * Enforces backpressure: if a client's pending queue exceeds maxQueueSize,
   * non-critical messages are dropped or backpressure warning is sent.
   */
  public publishOrderUpdate(
    orderId: string,
    status: Order["status"],
    additionalFields: Partial<Order> = {},
  ): void {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = status;
      order.updatedAt = new Date().toISOString();
      Object.assign(order, additionalFields);
    }

    const subscribers = this.orderSubscriptions.get(orderId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const payload = {
      type: "order_update",
      orderId,
      status,
      order: order || { id: orderId, status },
      timestamp: new Date().toISOString(),
    };

    for (const client of subscribers) {
      if (client.authenticated && client.socket.readyState === WS_READY_STATE.OPEN) {
        this.sendToClientWithBackpressure(client, payload);
      }
    }
  }

  private sendToClientWithBackpressure(client: ClientSession, payload: Record<string, unknown>): void {
    const isBufferedOverflown = (client.socket.bufferedAmount || 0) > 64 * 1024;
    const isQueueFull = client.pendingQueue.length >= client.maxQueueSize;

    if (isQueueFull || isBufferedOverflown) {
      this.emit("backpressure", { clientId: client.id, queueSize: client.pendingQueue.length });
      this.sendToClient(client, {
        type: "backpressure_warning",
        message: "Message buffer full. Updates dropped until queue drains.",
        queueSize: client.pendingQueue.length,
      });
      return;
    }

    this.sendToClient(client, payload);
  }

  public sendToClient(client: ClientSession, data: Record<string, unknown>): void {
    const jsonStr = JSON.stringify(data);
    try {
      client.socket.send(jsonStr);
    } catch {
      this.removeClient(client);
    }
  }

  public startHeartbeat(): void {
    if (this.heartbeatIntervalTimer) return;

    this.heartbeatIntervalTimer = setInterval(() => {
      this.checkHeartbeats();
    }, this.heartbeatIntervalMs);
  }

  public stopHeartbeat(): void {
    if (this.heartbeatIntervalTimer) {
      clearInterval(this.heartbeatIntervalTimer);
      this.heartbeatIntervalTimer = null;
    }
  }

  public checkHeartbeats(): void {
    for (const client of Array.from(this.clients.values())) {
      if (!client.isAlive) {
        this.emit("timeout_disconnect", { clientId: client.id, userId: client.userId });
        try {
          client.socket.close(4000, "Heartbeat timeout disconnect");
        } catch {
          // ignore
        }
        this.removeClient(client);
      } else {
        client.isAlive = false;
        if (typeof client.socket.ping === "function") {
          client.socket.ping();
        } else {
          this.sendToClient(client, { type: "ping" });
        }
      }
    }
  }

  public removeClient(client: ClientSession): void {
    client.isAlive = false;
    for (const orderId of client.subscriptions) {
      const subs = this.orderSubscriptions.get(orderId);
      if (subs) {
        subs.delete(client);
      }
    }
    client.subscriptions.clear();
    this.clients.delete(client.id);
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public getSubscriptionCount(orderId: string): number {
    return this.orderSubscriptions.get(orderId)?.size ?? 0;
  }
}

export const globalOrderWsServer = new OrderWebSocketServer();

export function __seedOrder(order: Order): void {
  globalOrderWsServer.seedOrder(order);
}

export function __resetOrders(): void {
  globalOrderWsServer.resetOrders();
}

export function __resetWebSocketServer(): void {
  globalOrderWsServer.resetServer();
}

export default globalOrderWsServer;

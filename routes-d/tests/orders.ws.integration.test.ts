import { EventEmitter } from "node:events";
import {
  OrderWebSocketServer,
  IWebSocket,
  WS_READY_STATE,
  Order,
} from "../routes/orders.ws.js";

class IntegrationMockWebSocket extends EventEmitter implements IWebSocket {
  public readyState: number = WS_READY_STATE.OPEN;
  public messages: any[] = [];
  public closedCode?: number;
  public closedReason?: string;
  public bufferedAmount: number = 0;

  public send(data: string): void {
    if (this.readyState !== WS_READY_STATE.OPEN) {
      throw new Error("Cannot send to closed socket");
    }
    const parsed = JSON.parse(data);
    this.messages.push(parsed);
    this.emit("sent", parsed);
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

  public sendClientMessage(obj: unknown): void {
    this.emit("message", JSON.stringify(obj));
  }

  public getMessagesByType(type: string): any[] {
    return this.messages.filter((m) => m.type === type);
  }
}

describe("Integration: OrderWebSocketServer", () => {
  let server: OrderWebSocketServer;

  beforeEach(() => {
    server = new OrderWebSocketServer({
      heartbeatIntervalMs: 50,
      heartbeatTimeoutMs: 100,
      maxQueueSize: 5,
    });
  });

  afterEach(() => {
    server.resetServer();
  });

  it("completes full order live update lifecycle: auth -> subscribe -> receive update -> unsubscribe", () => {
    const socket = new IntegrationMockWebSocket();
    const session = server.handleConnection(socket);

    // 1. Auth Handshake
    socket.sendClientMessage({ type: "auth", token: "token-user-123" });
    const authMsgs = socket.getMessagesByType("auth_success");
    expect(authMsgs.length).toBe(1);
    expect(session.authenticated).toBe(true);

    // 2. Subscribe to order
    socket.sendClientMessage({ type: "subscribe", orderId: "ord-1001" });
    const subMsgs = socket.getMessagesByType("subscribed");
    expect(subMsgs.length).toBe(1);
    expect(subMsgs[0].orderId).toBe("ord-1001");

    // 3. Publish order update from server
    server.publishOrderUpdate("ord-1001", "partially_filled", { amount: 500 });
    const updateMsgs = socket.getMessagesByType("order_update");
    expect(updateMsgs.length).toBe(1);
    expect(updateMsgs[0].status).toBe("partially_filled");

    // 4. Unsubscribe
    socket.sendClientMessage({ type: "unsubscribe", orderId: "ord-1001" });
    expect(socket.getMessagesByType("unsubscribed").length).toBe(1);

    // 5. Publish update after unsubscribing -> should NOT receive update
    server.publishOrderUpdate("ord-1001", "filled");
    expect(socket.getMessagesByType("order_update").length).toBe(1);
  });

  it("enforces backpressure when message queue overflows", () => {
    const socket = new IntegrationMockWebSocket();
    const session = server.handleConnection(socket, "token-user-123");
    socket.sendClientMessage({ type: "subscribe", orderId: "ord-1001" });

    // Fill queue to max size (5)
    session.pendingQueue = ["1", "2", "3", "4", "5"];

    server.publishOrderUpdate("ord-1001", "partially_filled");

    const warnings = socket.getMessagesByType("backpressure_warning");
    expect(warnings.length).toBe(1);
    expect(warnings[0].message).toContain("Message buffer full");
  });

  it("handles dead connection timeout disconnect automatically", () => {
    const socket = new IntegrationMockWebSocket();
    server.handleConnection(socket, "token-user-123");

    expect(server.getClientCount()).toBe(1);

    // Tick 1: sends ping, sets isAlive = false
    server.checkHeartbeats();

    // Client does NOT send pong back

    // Tick 2: timeout disconnect
    server.checkHeartbeats();

    expect(server.getClientCount()).toBe(0);
    expect(socket.closedCode).toBe(4000);
  });
});

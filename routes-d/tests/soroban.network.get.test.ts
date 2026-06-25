import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import networkRouter, {
  __resetNetwork,
  __setRpcAvailable,
  __setNetworkConfig,
} from "../routes/soroban.network.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(networkRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /soroban/network", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetNetwork();
  });

  it("returns 200 with networkPassphrase, rpcHost, and latestLedger when RPC is healthy", async () => {
    const res = await request(app).get("/soroban/network");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.networkPassphrase).toBe("Test SDF Network ; September 2015");
    expect(res.body.data.rpcHost).toBe("soroban-testnet.stellar.org");
    expect(res.body.data.latestLedger).toBe(12345678);
  });

  it("returns 503 RPC_UNAVAILABLE when RPC is degraded", async () => {
    __setRpcAvailable(false);

    const res = await request(app).get("/soroban/network");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("RPC_UNAVAILABLE");
  });

  it("rpcHost must not contain https:// or credentials — only the hostname", async () => {
    __setNetworkConfig(
      "Test SDF Network ; September 2015",
      "https://user:pass@soroban-testnet.stellar.org/rpc",
      12345678
    );

    const res = await request(app).get("/soroban/network");

    expect(res.status).toBe(200);
    expect(res.body.data.rpcHost).not.toContain("https://");
    expect(res.body.data.rpcHost).not.toContain("user:");
    expect(res.body.data.rpcHost).not.toContain("@");
    expect(res.body.data.rpcHost).not.toContain("/rpc");
    expect(res.body.data.rpcHost).toBe("soroban-testnet.stellar.org");
  });

  it("returns the configured latestLedger value", async () => {
    __setNetworkConfig("Test SDF Network ; September 2015", "https://soroban-testnet.stellar.org", 99999999);

    const res = await request(app).get("/soroban/network");

    expect(res.status).toBe(200);
    expect(res.body.data.latestLedger).toBe(99999999);
  });
});

import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import prefsGetRouter, {
  __resetPrefs,
  __seedPrefs,
  __getPrefs,
} from "../routes/account.prefs.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(prefsGetRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /account/preferences", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPrefs();
  });

  it("returns 401 UNAUTHORIZED when no x-user-id header is provided", async () => {
    const res = await request(app).get("/account/preferences");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns documented defaults when no preferences exist for the user", async () => {
    const res = await request(app)
      .get("/account/preferences")
      .set("x-user-id", "user-new");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const prefs = res.body.data.preferences;
    expect(prefs.theme).toBe("system");
    expect(prefs.currency).toBe("USD");
    expect(prefs.language).toBe("en");
    expect(prefs.notificationsEnabled).toBe(true);
  });

  it("returns persisted preferences when they exist for the user", async () => {
    __seedPrefs("user-1", {
      theme: "dark",
      currency: "EUR",
      language: "fr",
      notificationsEnabled: false,
    });

    const res = await request(app)
      .get("/account/preferences")
      .set("x-user-id", "user-1");

    expect(res.status).toBe(200);
    const prefs = res.body.data.preferences;
    expect(prefs.theme).toBe("dark");
    expect(prefs.currency).toBe("EUR");
    expect(prefs.language).toBe("fr");
    expect(prefs.notificationsEnabled).toBe(false);
  });

  it("isolates preferences between users", async () => {
    __seedPrefs("user-a", {
      theme: "dark",
      currency: "EUR",
      language: "fr",
      notificationsEnabled: false,
    });

    const res = await request(app)
      .get("/account/preferences")
      .set("x-user-id", "user-b");

    expect(res.status).toBe(200);
    const prefs = res.body.data.preferences;
    expect(prefs.theme).toBe("system");
    expect(prefs.currency).toBe("USD");
  });

  it("exposes the prefs store via __getPrefs for test assertions", () => {
    __seedPrefs("user-x", {
      theme: "light",
      currency: "XLM",
      language: "es",
      notificationsEnabled: true,
    });
    expect(__getPrefs().get("user-x")?.theme).toBe("light");
  });
});

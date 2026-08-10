import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import prefsRouter, { __resetPrefs, __getPrefs } from "../routes/account.prefs.update.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(prefsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("PATCH /account/preferences", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPrefs();
  });

  it("returns 200 and updated:true when a preference value changes", async () => {
    const res = await request(app)
      .patch("/account/preferences")
      .send({ theme: "dark" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.updated).toBe(true);
    expect(res.body.data.preferences.theme).toBe("dark");
  });

  it("persists multiple preference fields atomically", async () => {
    const res = await request(app)
      .patch("/account/preferences")
      .send({ theme: "light", currency: "EUR", language: "fr" });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(true);
    const p = __getPrefs();
    expect(p.theme).toBe("light");
    expect(p.currency).toBe("EUR");
    expect(p.language).toBe("fr");
  });

  it("returns updated:false when all sent values match existing preferences (no-op)", async () => {
    const res = await request(app)
      .patch("/account/preferences")
      .send({ theme: "system", currency: "USD" });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(false);
  });

  it("returns updated:false with current preferences when body is empty", async () => {
    const res = await request(app)
      .patch("/account/preferences")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(false);
    expect(res.body.data.preferences).toBeDefined();
  });

  it("returns 400 INVALID_PREFERENCE_VALUE for an invalid theme", async () => {
    const res = await request(app)
      .patch("/account/preferences")
      .send({ theme: "rainbow" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PREFERENCE_VALUE");
  });

  it("returns 400 INVALID_PREFERENCE_VALUE for an invalid currency", async () => {
    const res = await request(app)
      .patch("/account/preferences")
      .send({ currency: "GBP" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PREFERENCE_VALUE");
  });

  it("returns 400 INVALID_PREFERENCE_VALUE for an invalid language", async () => {
    const res = await request(app)
      .patch("/account/preferences")
      .send({ language: "zh" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PREFERENCE_VALUE");
  });

  it("returns 400 INVALID_PREFERENCE_VALUE when notificationsEnabled is not boolean", async () => {
    const res = await request(app)
      .patch("/account/preferences")
      .send({ notificationsEnabled: "yes" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PREFERENCE_VALUE");
  });
});

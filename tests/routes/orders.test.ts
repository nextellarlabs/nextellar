import request from "supertest";
import express from "express";
import ordersRouter from "../../backend/routes/orders.js";

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/orders", ordersRouter);
    return app;
}

describe("GET /orders", () => {
    const app = buildApp();

    it("should return the first page of orders by default", async () => {
        const res = await request(app).get("/orders");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.page).toBe(1);
        expect(res.body.limit).toBe(20);
        expect(res.body.data).toHaveLength(20);
        expect(res.body.total).toBe(200);
    });

    it("should handle custom page and limit", async () => {
        const res = await request(app).get("/orders?page=2&limit=5");
        expect(res.status).toBe(200);
        expect(res.body.page).toBe(2);
        expect(res.body.limit).toBe(5);
        expect(res.body.data).toHaveLength(5);
        expect(res.body.data[0].id).toBe("order-6");
    });

    it("should enforce maximum limit of 100", async () => {
        const res = await request(app).get("/orders?limit=500");
        expect(res.status).toBe(200);
        expect(res.body.limit).toBe(100);
        expect(res.body.data).toHaveLength(100);
    });

    it("should handle invalid page (less than 1)", async () => {
        const res = await request(app).get("/orders?page=0");
        expect(res.status).toBe(200);
        expect(res.body.page).toBe(1);
    });

    it("should handle invalid limit (less than 1)", async () => {
        const res = await request(app).get("/orders?limit=0");
        expect(res.status).toBe(200);
        expect(res.body.limit).toBe(20); // Default to 20 if 0 or invalid
    });

    it("should handle negative values", async () => {
        const res = await request(app).get("/orders?page=-1&limit=-5");
        expect(res.status).toBe(200);
        expect(res.body.page).toBe(1);
        expect(res.body.limit).toBe(20);
    });

    it("should return empty data for out of bounds page", async () => {
        const res = await request(app).get("/orders?page=50");
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(0);
    });
});

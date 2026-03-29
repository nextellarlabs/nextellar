import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import { globalErrorHandler } from "../../backend/middleware/errorHandler.js";

function buildApp() {
    const app = express();
    app.get("/__error_test", (req: Request, res: Response, next: NextFunction) => {
        next(new Error("Test Error"));
    });
    app.use(globalErrorHandler);
    return app;
}

describe("Global Error Handler", () => {
    const OriginalNodeEnv = process.env.NODE_ENV;
    let app: express.Application;

    beforeEach(() => {
        // Reset NODE_ENV before each test
        process.env.NODE_ENV = "development";
        jest.clearAllMocks();
        app = buildApp();
    });

    afterAll(() => {
        process.env.NODE_ENV = OriginalNodeEnv;
    });

    it("should leak stack trace when NODE_ENV is development", async () => {
        process.env.NODE_ENV = "development";

        // Spy on console.error
        const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => { });

        const res = await request(app).get("/__error_test");

        expect(consoleSpy).toHaveBeenCalled();
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe("Test Error");
        expect(res.body.stack).toBeDefined();

        consoleSpy.mockRestore();
    });

    it("should hide stack trace and return a generic message when NODE_ENV is production", async () => {
        process.env.NODE_ENV = "production";

        // Spy on console.error
        const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => { });

        const res = await request(app).get("/__error_test");

        expect(consoleSpy).toHaveBeenCalled();
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe("Internal Server Error");
        expect(res.body.stack).toBeUndefined();

        consoleSpy.mockRestore();
    });
});

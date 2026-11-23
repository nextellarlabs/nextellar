import {
  HorizonError,
  classifyHorizonError,
  toThrowableHorizonError,
} from "../../src/templates/default/src/lib/horizon-errors";

function httpError(status: number, message = "Horizon failure", extra = {}) {
  return Object.assign(new Error(message), { response: { status }, ...extra });
}

describe("classifyHorizonError", () => {
  describe("400 Bad Request", () => {
    it("classifies as bad_request with per-context wording", () => {
      const err = httpError(400, "bad");
      const read = classifyHorizonError(err, { context: "read" });
      expect(read).toBeInstanceOf(HorizonError);
      expect(read.kind).toBe("bad_request");
      expect(read.status).toBe(400);
      expect(read.message).toBe("Client error: bad (Status: 400)");
      expect(classifyHorizonError(err, { context: "build" }).message).toBe(
        "Invalid request: bad",
      );
      expect(classifyHorizonError(err, { context: "submit" }).message).toBe(
        "Invalid transaction format or content",
      );
    });

    it("classifies other 4xx as client_error", () => {
      const e = classifyHorizonError(httpError(403, "nope"));
      expect(e.kind).toBe("client_error");
      expect(e.message).toBe("Client error: nope (Status: 403)");
    });

    it("prefers result codes over the bare status", () => {
      const err = Object.assign(new Error("Request failed"), {
        response: {
          status: 400,
          data: {
            extras: {
              result_codes: {
                transaction: "tx_failed",
                operations: ["op_no_destination"],
              },
            },
          },
        },
      });
      const e = classifyHorizonError(err, { context: "submit" });
      expect(e.kind).toBe("transaction_failed");
      expect(e.message).toMatch(/destination account does not exist/i);
      expect(e.resultCodes).toEqual({
        transaction: "tx_failed",
        operations: ["op_no_destination"],
      });
      expect(e.raw).toBe(err.response.data);
    });
  });

  describe("404 Not Found", () => {
    it("classifies a 404 response as not_found", () => {
      const e = classifyHorizonError(httpError(404));
      expect(e.kind).toBe("not_found");
      expect(e.status).toBe(404);
    });

    it("classifies an SDK NotFoundError without a status", () => {
      const err = Object.assign(new Error("Not Found"), {
        name: "NotFoundError",
      });
      expect(classifyHorizonError(err).kind).toBe("not_found");
    });

    it("names the account for build failures", () => {
      const e = classifyHorizonError(httpError(404), {
        context: "build",
        accountId: "GABC",
      });
      expect(e.message).toBe(
        "Account GABC not found. Account may need funding.",
      );
    });
  });

  describe("429 Too Many Requests", () => {
    it("classifies as rate_limited and mentions the status", () => {
      const e = classifyHorizonError(httpError(429));
      expect(e.kind).toBe("rate_limited");
      expect(e.status).toBe(429);
      expect(e.message).toContain("429");
      expect(e.retryAfterSeconds).toBeUndefined();
    });

    it("exposes Retry-After from plain header objects", () => {
      const e = classifyHorizonError(
        Object.assign(new Error("slow down"), {
          response: { status: 429, headers: { "retry-after": "7" } },
        }),
      );
      expect(e.retryAfterSeconds).toBe(7);
      expect(e.message).toContain("7s");
    });

    it("exposes Retry-After from Headers-like objects", () => {
      const e = classifyHorizonError(
        Object.assign(new Error("slow down"), {
          response: {
            status: 429,
            headers: { get: (n: string) => (n === "retry-after" ? "3" : null) },
          },
        }),
      );
      expect(e.retryAfterSeconds).toBe(3);
    });

    it("recognises a fetch-style status on the error itself", () => {
      const e = classifyHorizonError(
        Object.assign(new Error("Horizon error 429"), { status: 429 }),
      );
      expect(e.kind).toBe("rate_limited");
    });
  });

  describe("5xx server errors", () => {
    it.each([500, 502, 503])("classifies %i as server_error", (status) => {
      const e = classifyHorizonError(httpError(status, "boom"));
      expect(e.kind).toBe("server_error");
      expect(e.status).toBe(status);
    });

    it("words server errors per context", () => {
      const err = httpError(503, "Service Unavailable");
      expect(classifyHorizonError(err, { context: "read" }).message).toBe(
        "Network error: Service Unavailable",
      );
      expect(classifyHorizonError(err, { context: "build" }).message).toBe(
        "Horizon server error: Service Unavailable",
      );
      expect(classifyHorizonError(err, { context: "submit" }).message).toBe(
        "Horizon server error during submission",
      );
    });
  });

  describe("network failures", () => {
    it.each([
      ["browser fetch failure", new TypeError("Failed to fetch")],
      ["undici fetch failure", new TypeError("fetch failed")],
      [
        "axios network error",
        Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }),
      ],
      [
        "connection refused",
        Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }),
      ],
      [
        "timeout",
        Object.assign(new Error("timeout of 5000ms exceeded"), {
          code: "ECONNABORTED",
        }),
      ],
    ])("classifies %s as network", (_label, err) => {
      const e = classifyHorizonError(err);
      expect(e.kind).toBe("network");
      expect(e.status).toBeUndefined();
      expect(e.message).toMatch(/^Network error: /);
      expect(e.originalError).toBe(err);
    });
  });

  describe("unknown errors", () => {
    it("keeps the original message and does not claim to be a Horizon failure", () => {
      const e = classifyHorizonError(
        new Error("Memo text cannot exceed 28 characters"),
      );
      expect(e.kind).toBe("unknown");
      expect(e.message).toBe("Memo text cannot exceed 28 characters");
    });

    it("handles non-Error values and applies the fallback message", () => {
      expect(classifyHorizonError(undefined).kind).toBe("unknown");
      expect(
        classifyHorizonError("boom", { fallbackMessage: "custom" }).message,
      ).toBe("custom");
    });

    it("returns an existing HorizonError unchanged", () => {
      const first = classifyHorizonError(httpError(404));
      expect(classifyHorizonError(first, { context: "build" })).toBe(first);
    });
  });
});

describe("toThrowableHorizonError", () => {
  it("returns the typed error for recognised Horizon failures", () => {
    const err = httpError(500);
    const classified = classifyHorizonError(err);
    expect(toThrowableHorizonError(err, classified, "fallback")).toBe(
      classified,
    );
  });

  it("returns the original Error for unknown failures", () => {
    const err = new Error("validation");
    expect(
      toThrowableHorizonError(err, classifyHorizonError(err), "fallback"),
    ).toBe(err);
  });

  it("wraps non-Error unknown values using the fallback message", () => {
    const thrown = toThrowableHorizonError(
      "x",
      classifyHorizonError("x"),
      "fallback",
    );
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toBe("fallback");
  });
});

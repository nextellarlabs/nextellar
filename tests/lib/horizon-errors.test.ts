import { classifyHorizonError } from "../../src/templates/default/src/lib/horizon-errors";

describe("classifyHorizonError", () => {
  it("classifies HTTP 400 bad requests", () => {
    const err = {
      message: "Bad Request",
      response: { status: 400 },
    };

    const classified = classifyHorizonError(err);
    expect(classified.kind).toBe("bad_request");
    expect(classified.status).toBe(400);
    expect(classified.retryable).toBe(false);
    expect(classified.userMessage).toContain("Bad Request");
  });

  it("classifies HTTP 404 responses and NotFoundError instances as not_found", () => {
    const http404 = classifyHorizonError({ response: { status: 404 } });
    expect(http404.kind).toBe("not_found");
    expect(http404.status).toBe(404);
    expect(http404.retryable).toBe(false);
    expect(http404.userMessage).toMatch(/not found/i);

    const sdk404 = Object.assign(new Error("Missing account"), {
      name: "NotFoundError",
    });
    expect(classifyHorizonError(sdk404).kind).toBe("not_found");
  });

  it("classifies HTTP 429 rate limits as retryable", () => {
    const classified = classifyHorizonError({ response: { status: 429 } });
    expect(classified.kind).toBe("rate_limited");
    expect(classified.status).toBe(429);
    expect(classified.retryable).toBe(true);
    expect(classified.userMessage).toMatch(/rate limit/i);
  });

  it("classifies 5xx server errors as retryable", () => {
    const err503 = classifyHorizonError({
      message: "Service Unavailable",
      response: { status: 503 },
    });
    expect(err503.kind).toBe("server_error");
    expect(err503.status).toBe(503);
    expect(err503.retryable).toBe(true);
    expect(err503.message).toBe("Service Unavailable");

    const err500 = classifyHorizonError({ response: { status: 500 } });
    expect(err500.kind).toBe("server_error");
    expect(err500.status).toBe(500);
    expect(err500.retryable).toBe(true);
  });

  it("decodes Horizon result_codes payloads when present", () => {
    const err = {
      message: "Transaction failed",
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
    };

    const classified = classifyHorizonError(err);
    expect(classified.kind).toBe("result_code_error");
    expect(classified.retryable).toBe(false);
    expect(classified.resultCodes).toEqual({
      transaction: "tx_failed",
      operations: ["op_no_destination"],
    });
    expect(classified.userMessage).toMatch(
      /destination account does not exist/i,
    );
  });

  it("classifies fetch and socket network failures as retryable network_error", () => {
    const fetchErr = new TypeError("Failed to fetch");
    const classifiedFetch = classifyHorizonError(fetchErr);
    expect(classifiedFetch.kind).toBe("network_error");
    expect(classifiedFetch.retryable).toBe(true);
    expect(classifiedFetch.userMessage).toContain("Failed to fetch");

    const connErr = Object.assign(new Error("connect failed"), {
      code: "ECONNREFUSED",
    });
    const classifiedConn = classifyHorizonError(connErr);
    expect(classifiedConn.kind).toBe("network_error");
    expect(classifiedConn.retryable).toBe(true);
  });
});

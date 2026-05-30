import type { Response } from "express";
import { applyCacheHeaders, createPayloadEtag } from "../lib/cacheHeaders.js";

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    status: jest.fn(),
  } as unknown as Pick<Response, "setHeader" | "status">;
  return { res, headers };
}

describe("cacheHeaders", () => {
  it("creates a stable ETag from the payload", () => {
    expect(createPayloadEtag({ a: 1, b: "x" })).toBe(createPayloadEtag({ a: 1, b: "x" }));
  });

  it("applies cache headers and returns 200 when the ETag does not match", () => {
    const { res, headers } = makeRes();
    const result = applyCacheHeaders(res, { hello: "world" }, {}, { maxAgeSeconds: 10, sMaxAgeSeconds: 20 });

    expect(result.notModified).toBe(false);
    expect(headers["ETag"]).toBe(result.etag);
    expect(headers["Cache-Control"]).toBe("public, max-age=10, s-maxage=20");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 304 when If-None-Match matches the generated ETag", () => {
    const { res } = makeRes();
    const payload = { hello: "world" };
    const etag = createPayloadEtag(payload);

    const result = applyCacheHeaders(res, payload, { "if-none-match": etag });

    expect(result.notModified).toBe(true);
    expect(res.status).toHaveBeenCalledWith(304);
  });

  it("treats a missing If-None-Match header as a cache miss", () => {
    const { res } = makeRes();
    const result = applyCacheHeaders(res, "payload", {});
    expect(result.notModified).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });
});

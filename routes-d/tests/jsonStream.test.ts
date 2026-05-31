import { PassThrough } from "node:stream";
import { jest } from "@jest/globals";
import type { Response } from "express";
import {
  collectJsonArrayStream,
  createBackpressureSource,
  pipeJsonArray,
} from "../lib/jsonStream.js";

function mockResponse(): Response {
  const stream = new PassThrough();
  const res = stream as unknown as Response;
  res.setHeader = jest.fn() as Response["setHeader"];
  res.status = jest.fn().mockReturnThis() as Response["status"];
  return res;
}

describe("jsonStream", () => {
  it("streams a small array as valid JSON", async () => {
    const res = mockResponse();
    const chunks: string[] = [];
    (res as unknown as PassThrough).on("data", (chunk) => chunks.push(chunk.toString()));

    async function* source() {
      yield { id: 1 };
      yield { id: 2 };
    }

    await pipeJsonArray(res, source());
    const body = chunks.join("");
    expect(JSON.parse(body)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("streams a large array without buffering the full payload first", async () => {
    const res = mockResponse();
    const chunks: string[] = [];
    (res as unknown as PassThrough).on("data", (chunk) => chunks.push(chunk.toString()));

    async function* source() {
      for (let i = 0; i < 500; i += 1) {
        yield { id: i };
      }
    }

    await pipeJsonArray(res, source(), { chunkSize: 25 });
    const body = chunks.join("");
    const parsed = JSON.parse(body) as Array<{ id: number }>;
    expect(parsed).toHaveLength(500);
    expect(parsed[0]).toEqual({ id: 0 });
    expect(parsed[499]).toEqual({ id: 499 });
  });

  it("applies backpressure to upstream sources", async () => {
    let pauseCount = 0;
    let resumeCount = 0;

    async function* source() {
      for (let i = 0; i < 5; i += 1) {
        yield i;
      }
    }

    const wrapped = createBackpressureSource(source(), 1);
    const originalPause = wrapped.pause!.bind(wrapped);
    const originalResume = wrapped.resume!.bind(wrapped);
    wrapped.pause = () => {
      pauseCount += 1;
      originalPause();
    };
    wrapped.resume = () => {
      resumeCount += 1;
      originalResume();
    };

    const res = mockResponse();
    let writeCount = 0;
    const originalWrite = res.write.bind(res);
    res.write = ((chunk: string) => {
      writeCount += 1;
      if (writeCount === 2) {
        setImmediate(() => streamDrain(res));
        return false;
      }
      return originalWrite(chunk);
    }) as Response["write"];

    await pipeJsonArray(res, wrapped);
    expect(pauseCount).toBeGreaterThan(0);
    expect(resumeCount).toBeGreaterThan(0);
  });

  it("collects async iterable output", async () => {
    async function* source() {
      yield "a";
      yield "b";
    }
    await expect(collectJsonArrayStream(source())).resolves.toEqual(["a", "b"]);
  });
});

function streamDrain(res: Response): void {
  res.emit("drain");
}

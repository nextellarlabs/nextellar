import type { Response } from "express";

export interface JsonStreamSource<T> extends AsyncIterable<T> {
  pause?(): void;
  resume?(): void;
}

export interface JsonStreamOptions {
  chunkSize?: number;
}

function isBackpressured(res: Response): boolean {
  if (typeof res.writableNeedDrain !== "boolean") {
    return false;
  }
  return res.writableLength > 0 && !res.writableNeedDrain;
}

async function waitForDrain(res: Response): Promise<void> {
  if (!isBackpressured(res)) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("response closed"));
    };
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("error", onError);
      res.off("close", onClose);
    };
    res.once("drain", onDrain);
    res.once("error", onError);
    res.once("close", onClose);
  });
}

async function writeChunk(
  res: Response,
  chunk: string,
  source?: JsonStreamSource<unknown>,
): Promise<void> {
  if (res.destroyed || res.writableEnded) {
    throw new Error("response closed");
  }
  const ok = res.write(chunk);
  if (!ok) {
    source?.pause?.();
    await waitForDrain(res);
    source?.resume?.();
  }
}

export async function pipeJsonArray<T>(
  res: Response,
  source: JsonStreamSource<T>,
  options: JsonStreamOptions = {},
): Promise<void> {
  const chunkSize = options.chunkSize ?? 1;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  let first = true;
  await writeChunk(res, "[", source);

  const buffer: T[] = [];
  const flush = async () => {
    if (buffer.length === 0) {
      return;
    }
    const parts = buffer.map((item) => JSON.stringify(item));
    buffer.length = 0;
    const payload = (first ? "" : ",") + parts.join(",");
    first = false;
    await writeChunk(res, payload, source);
  };

  try {
    for await (const item of source) {
      buffer.push(item);
      if (buffer.length >= chunkSize) {
        await flush();
      }
    }
    await flush();
    await writeChunk(res, "]", source);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500);
    }
    if (!res.writableEnded) {
      res.end();
    }
    throw err;
  }
}

export function createBackpressureSource<T>(
  items: Iterable<T> | AsyncIterable<T>,
  highWaterMark = 2,
): JsonStreamSource<T> {
  let paused = false;
  let resumeCallback: (() => void) | undefined;

  const waitIfPaused = async () => {
    if (!paused) {
      return;
    }
    await new Promise<void>((resolve) => {
      resumeCallback = resolve;
    });
  };

  async function* generator(): AsyncGenerator<T> {
    for await (const item of items) {
      await waitIfPaused();
      yield item;
    }
  }

  const iterable = generator();

  return {
    [Symbol.asyncIterator]() {
      return iterable;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      resumeCallback?.();
      resumeCallback = undefined;
    },
  };
}

export async function collectJsonArrayStream<T>(
  source: AsyncIterable<T>,
): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

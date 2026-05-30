import type { NextFunction, Request, Response } from "express";
import type { Server } from "node:http";

export interface ShutdownClient {
  close: () => Promise<void> | void;
}

export interface GracefulShutdownOptions {
  server?: Server;
  closeClients?: ShutdownClient[];
  drainTimeoutMs?: number;
  exit?: (code: number) => never | void;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface GracefulShutdownController {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  beginWork: () => () => void;
  track: <T>(work: Promise<T>) => Promise<T>;
  shutdown: (signal?: NodeJS.Signals) => Promise<void>;
  install: () => void;
  dispose: () => void;
  isShuttingDown: () => boolean;
}

const DEFAULT_DRAIN_TIMEOUT_MS = Number(process.env.NEXTELLAR_SHUTDOWN_TIMEOUT_MS ?? 10_000);

export function createGracefulShutdownController(
  options: GracefulShutdownOptions = {},
): GracefulShutdownController {
  const server = options.server;
  const closeClients = options.closeClients ?? [];
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const logger = options.logger ?? console;

  let acceptingWork = true;
  let inflight = 0;
  let shuttingDown = false;
  let drainPromise: Promise<void> | null = null;
  let signalHandler: ((signal: NodeJS.Signals) => void) | null = null;

  function beginWork(): () => void {
    if (!acceptingWork) {
      throw new Error("Server is shutting down");
    }

    inflight += 1;
    let done = false;

    return () => {
      if (done) {
        return;
      }
      done = true;
      inflight = Math.max(0, inflight - 1);
    };
  }

  async function waitForDrain(): Promise<void> {
    const deadline = Date.now() + drainTimeoutMs;
    while (inflight > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    if (inflight > 0) {
      throw new Error(`Graceful shutdown timed out after ${drainTimeoutMs}ms`);
    }
  }

  async function closeServer(): Promise<void> {
    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  async function closeRegisteredClients(): Promise<void> {
    for (const client of closeClients) {
      await client.close();
    }
  }

  async function shutdown(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    if (drainPromise) {
      return drainPromise;
    }

    acceptingWork = false;
    shuttingDown = true;
    logger.info?.(`[shutdown] received ${signal}, draining inflight work`);

    drainPromise = (async () => {
      try {
        await closeServer();
        await waitForDrain();
        await closeRegisteredClients();
        logger.info?.("[shutdown] drain complete");
        exit(0);
      } catch (error) {
        logger.error?.("[shutdown] forced exit after drain timeout or close failure", error);
        exit(1);
      }
    })();

    return drainPromise;
  }

  function middleware(req: Request, res: Response, next: NextFunction): void {
    if (!acceptingWork) {
      res.status(503).json({ error: "server_shutting_down" });
      return;
    }

    const complete = beginWork();
    let finalized = false;

    const finalize = (): void => {
      if (finalized) {
        return;
      }
      finalized = true;
      complete();
    };

    res.once("finish", finalize);
    res.once("close", finalize);
    next();
  }

  function install(): void {
    if (signalHandler) {
      return;
    }

    signalHandler = (signal: NodeJS.Signals): void => {
      void shutdown(signal);
    };

    process.on("SIGTERM", signalHandler);
    process.on("SIGINT", signalHandler);
  }

  function dispose(): void {
    if (!signalHandler) {
      return;
    }

    process.off("SIGTERM", signalHandler);
    process.off("SIGINT", signalHandler);
    signalHandler = null;
  }

  async function track<T>(work: Promise<T>): Promise<T> {
    const complete = beginWork();
    try {
      return await work;
    } finally {
      complete();
    }
  }

  return {
    middleware,
    beginWork,
    track,
    shutdown,
    install,
    dispose,
    isShuttingDown: () => shuttingDown,
  };
}

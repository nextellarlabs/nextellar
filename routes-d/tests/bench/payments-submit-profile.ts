// Payment-submit hot-path benchmark (#314).
//
// Stands up a minimal in-process payment-submit pipeline (request
// validation → idempotency lookup → simulated submit → response
// shaping) and measures end-to-end latency. The pipeline is
// self-contained on purpose: this benchmark is meant to detect
// regressions in the validation / serialization layers used by every
// payment-submit route, not the latency of a live RPC.

import { randomBytes } from "node:crypto";
import { recordRun, summariseLatencies } from "./_recorder.js";

export interface PaymentBenchOptions {
  payments?: number;
  duplicateRatio?: number;
  outputPath?: string;
  p99BudgetMs?: number;
  maxBudgetMs?: number;
  /** Captured-once timestamp written to the CSV. */
  recordedAt?: string;
}

interface PaymentRequest {
  idempotencyKey: string;
  amount: string;
  asset: string;
  destination: string;
}

function buildRequest(i: number): PaymentRequest {
  return {
    idempotencyKey: randomBytes(12).toString("hex"),
    amount: (10 + (i % 1000)).toFixed(7),
    asset: i % 3 === 0 ? "USDC" : "XLM",
    destination: `G${"A".repeat(55)}`,
  };
}

function validate(req: PaymentRequest): void {
  if (!req.idempotencyKey || req.idempotencyKey.length < 8) {
    throw new Error("idempotencyKey too short");
  }
  const amount = Number(req.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("invalid amount");
  }
  if (!req.destination.startsWith("G") || req.destination.length !== 56) {
    throw new Error("invalid destination");
  }
}

function shapeResponse(req: PaymentRequest): { id: string; status: string } {
  return {
    id: randomBytes(16).toString("hex"),
    status: "pending",
  };
}

export interface PaymentBenchResult {
  count: number;
  p50: number;
  p99: number;
  /** Filled when `recordedAt` was passed. */
  csvPath?: string;
}

/** Run the benchmark, return summary stats. When `recordedAt` is
 *  provided the recorder appends to the CSV ledger and throws on
 *  regression; pass it from CI, omit it from unit tests. */
export async function runPaymentsSubmitProfile(
  options: PaymentBenchOptions = {},
): Promise<PaymentBenchResult> {
  const payments = options.payments ?? 500;
  const duplicateRatio = options.duplicateRatio ?? 0.05;
  const seen = new Set<string>();
  const samples: number[] = [];

  for (let i = 0; i < payments; i += 1) {
    let req = buildRequest(i);
    if (Math.random() < duplicateRatio && seen.size > 0) {
      // Re-use a previous idempotency key to exercise the
      // dedupe-path.
      const previous = Array.from(seen)[seen.size - 1];
      req = { ...req, idempotencyKey: previous ?? req.idempotencyKey };
    }
    const t0 = performance.now();
    validate(req);
    if (!seen.has(req.idempotencyKey)) {
      seen.add(req.idempotencyKey);
      shapeResponse(req);
    }
    samples.push(performance.now() - t0);
  }

  const stats = summariseLatencies(samples);

  if (options.recordedAt) {
    const recorded = await recordRun(
      samples,
      {
        profile: "payments.submit",
        outputPath: options.outputPath,
        p99BudgetMs: options.p99BudgetMs,
        maxBudgetMs: options.maxBudgetMs,
      },
      options.recordedAt,
    );
    return { count: stats.count, p50: stats.p50, p99: stats.p99, csvPath: recorded.csvPath };
  }

  return { count: stats.count, p50: stats.p50, p99: stats.p99 };
}

if (process.argv[1]?.endsWith("payments-submit-profile.ts")) {
  runPaymentsSubmitProfile({
    payments: Number(process.env.ROUTES_D_BENCH_PAYMENTS ?? 1000),
    recordedAt: new Date().toISOString(),
    p99BudgetMs: Number(process.env.ROUTES_D_BENCH_P99_MS ?? 250),
  }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}

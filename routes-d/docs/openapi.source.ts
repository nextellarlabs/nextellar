import { toOpenApiSchema } from "../lib/validators.js";
import { depositRequestValidator, depositResponseValidator, withdrawRequestValidator, withdrawResponseValidator } from "../routes/validators.stellar.pool.js";
import { streamResponseValidator } from "../routes/validators.stellar.ledger.js";

export function buildOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: { title: "Nextellar routes-d API", version: "1.0.0" },
    paths: {
      "/stellar/pool/deposit": { post: { operationId: "stellarPoolDeposit", requestBody: { required: true, content: { "application/json": { schema: toOpenApiSchema(depositRequestValidator) } } }, responses: { "200": { description: "Unsigned deposit envelope", content: { "application/json": { schema: toOpenApiSchema(depositResponseValidator) } } } } } },
      "/stellar/pool/withdraw": { post: { operationId: "stellarPoolWithdraw", requestBody: { required: true, content: { "application/json": { schema: toOpenApiSchema(withdrawRequestValidator) } } }, responses: { "200": { description: "Unsigned withdrawal envelope", content: { "application/json": { schema: toOpenApiSchema(withdrawResponseValidator) } } } } } },
      "/stellar/ledger/stream": { get: { operationId: "stellarLedgerStream", responses: { "200": { description: "SSE stream of ledger close events", content: { "text/event-stream": { schema: toOpenApiSchema(streamResponseValidator) } } } } } },
    },
  };
}

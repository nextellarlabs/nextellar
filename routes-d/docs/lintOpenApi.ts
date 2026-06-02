import * as fs from "node:fs";

export function lintOpenApiContent(content: string): string[] {
  const errors: string[] = [];
  if (!content.includes('openapi: "3.0.3"')) errors.push("Missing or invalid OpenAPI version");
  if (!content.includes("paths:")) errors.push("Spec must include paths");
  const operationIds = [...content.matchAll(/operationId:\s+"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  if (new Set(operationIds).size !== operationIds.length) errors.push("operationId values must be unique");
  return errors;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const content = fs.readFileSync("routes-d/docs/openapi.yaml", "utf8");
  const errors = lintOpenApiContent(content);
  if (errors.length > 0) {
    process.stderr.write(`OpenAPI lint failed:\n${errors.map((e) => `- ${e}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("OpenAPI lint passed\n");
}

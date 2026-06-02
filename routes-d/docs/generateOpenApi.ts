import * as fs from "node:fs";
import * as path from "node:path";
import { buildOpenApiDocument } from "./openapi.source.js";
import { toYaml } from "./yaml.js";

export function generateOpenApiYaml(): string {
  return `${toYaml(buildOpenApiDocument())}\n`;
}

const outPath = path.resolve("routes-d/docs/openapi.yaml");

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  fs.writeFileSync(outPath, generateOpenApiYaml(), "utf8");
  process.stdout.write(`Generated ${outPath}\n`);
}

import * as fs from "node:fs";
import { generateOpenApiYaml } from "../docs/generateOpenApi.js";
import { lintOpenApiContent } from "../docs/lintOpenApi.js";

describe("routes-d openapi", () => {
  it("stays in sync with runtime validators", () => {
    const generated = generateOpenApiYaml();
    const saved = fs.readFileSync("routes-d/docs/openapi.yaml", "utf8");
    expect(saved).toBe(generated);
  });

  it("passes lint checks", () => {
    const errors = lintOpenApiContent(fs.readFileSync("routes-d/docs/openapi.yaml", "utf8"));
    expect(errors).toEqual([]);
  });
});

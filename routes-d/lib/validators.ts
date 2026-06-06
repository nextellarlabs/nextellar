export type PrimitiveType = "string" | "number" | "boolean";

export type ValidatorSpec =
  | { type: PrimitiveType; format?: string; enum?: string[] }
  | { type: "object"; required: string[]; properties: Record<string, ValidatorSpec> };

export const v = {
  string: (format?: string, enumValues?: string[]): ValidatorSpec => ({ type: "string", format, enum: enumValues }),
  number: (): ValidatorSpec => ({ type: "number" }),
  boolean: (): ValidatorSpec => ({ type: "boolean" }),
  object: (properties: Record<string, ValidatorSpec>, required: string[]): ValidatorSpec => ({ type: "object", properties, required }),
};

export function toOpenApiSchema(spec: ValidatorSpec): Record<string, unknown> {
  if (spec.type === "object") {
    const schemaProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(spec.properties)) schemaProps[key] = toOpenApiSchema(value);
    return { type: "object", required: spec.required, properties: schemaProps };
  }

  const out: Record<string, unknown> = { type: spec.type };
  if (spec.format) out.format = spec.format;
  if (spec.enum) out.enum = spec.enum;
  return out;
}

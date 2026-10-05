export const PROJECT_CONFIG_SCHEMA_VERSION = 1;

export interface ProjectConfig {
  schemaVersion: number;
  nextellarVersion: string;
  template: string;
  createdAt: string;
  [key: string]: unknown;
}

export function validateProjectConfig(value: unknown): ProjectConfig {
  if (!value || typeof value !== "object")
    throw new Error("Invalid .nextellar/config.json: expected an object");
  const config = value as Record<string, unknown>;
  if (config.schemaVersion !== PROJECT_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Invalid .nextellar/config.json: schemaVersion must be ${PROJECT_CONFIG_SCHEMA_VERSION}`,
    );
  }
  for (const field of ["nextellarVersion", "template", "createdAt"]) {
    if (typeof config[field] !== "string" || !config[field]) {
      throw new Error(`Invalid .nextellar/config.json: ${field} is required`);
    }
  }
  return config as ProjectConfig;
}

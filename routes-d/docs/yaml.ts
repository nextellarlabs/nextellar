function scalar(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return `"${String(value)}"`;
}

export function toYaml(value: unknown, indent = 0): string {
  const space = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === "object") ? `${space}-\n${toYaml(item, indent + 2)}` : `${space}- ${scalar(item)}`).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, child]) => (child && typeof child === "object") ? `${space}${key}:\n${toYaml(child, indent + 2)}` : `${space}${key}: ${scalar(child)}`).join("\n");
  }
  return `${space}${scalar(value)}`;
}

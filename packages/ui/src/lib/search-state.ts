export type SettingsSection =
  | "providers"
  | "github"
  | "costs"
  | "pricing"
  | "proxy"
  | "data"
  | "about";

export function isSettingsSection(value: string): value is SettingsSection {
  return (
    value === "providers" ||
    value === "github" ||
    value === "costs" ||
    value === "pricing" ||
    value === "proxy" ||
    value === "data" ||
    value === "about"
  );
}

export function parseSettingsSection(value: unknown): SettingsSection | undefined {
  return typeof value === "string" && isSettingsSection(value) ? value : undefined;
}

export function getIsoNow(): string {
  return new Date().toISOString();
}

export function getDateKey(value: Date | number | string = Date.now()): string {
  const date = typeof value === "string" ? new Date(value) : new Date(value);

  return date.toISOString().slice(0, 10);
}

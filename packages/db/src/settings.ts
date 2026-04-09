import { getIsoNow } from "@gitinspect/pi/lib/dates";
import type { JsonValue } from "@gitinspect/pi/types/common";
import { db } from "./db";
import type { SettingsRow } from "./types";

export async function setSetting(key: string, value: JsonValue): Promise<void> {
  await db.settings.put({
    key,
    updatedAt: getIsoNow(),
    value,
  });
}

export async function getSetting(key: string): Promise<JsonValue | undefined> {
  return (await db.settings.get(key))?.value;
}

export async function getAllSettings(): Promise<SettingsRow[]> {
  return await db.settings.toArray();
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
}

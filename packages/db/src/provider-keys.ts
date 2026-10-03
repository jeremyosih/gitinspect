import { getIsoNow } from "@gitinspect/shared/lib/dates";
import type { ProviderId } from "@gitinspect/shared/types/models";
import { db } from "./db";
import type { ProviderKeyRecord } from "./types";

export async function setProviderKey(provider: ProviderId, value: string): Promise<void> {
  await db.providerKeys.put({
    provider,
    updatedAt: getIsoNow(),
    value,
  });
}

export async function getProviderKey(provider: ProviderId): Promise<ProviderKeyRecord | undefined> {
  return await db.providerKeys.get(provider);
}

export async function listProviderKeys(): Promise<ProviderKeyRecord[]> {
  return await db.providerKeys.toArray();
}

export async function deleteProviderKey(provider: ProviderId): Promise<void> {
  await db.providerKeys.delete(provider);
}

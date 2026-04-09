import type { TokenFinalResponse } from "dexie-cloud-common";
import { db, type AppDb } from "./db";
import { UNSYNCED_TABLES } from "./schema";

export type DexieCloudTokenParams = {
  public_key: string;
  hints?: {
    email?: string;
    userId?: string;
  };
};

export type ConfigureDbCloudOptions = {
  databaseUrl?: string;
  fetchTokens: (tokenParams: DexieCloudTokenParams) => Promise<TokenFinalResponse>;
  syncEnabled: boolean;
};

let cloudInitialized = false;
let cloudSyncEnabled = false;
let openPromise: Promise<AppDb> | undefined;

export function configureDbCloud(options: ConfigureDbCloudOptions): void {
  if (cloudInitialized) {
    return;
  }

  if (db.isOpen()) {
    throw new Error("configureDbCloud() must run before the database is opened.");
  }

  const databaseUrl = options.syncEnabled ? options.databaseUrl : undefined;

  db.cloud.configure({
    // Dexie Cloud runtime supports omitting sync by providing an undefined database URL,
    // even though the published type currently expects a string.
    databaseUrl: databaseUrl as string,
    fetchTokens: options.fetchTokens,
    nameSuffix: false,
    requireAuth: true,
    unsyncedTables: [...UNSYNCED_TABLES],
  });

  cloudInitialized = true;
  cloudSyncEnabled = Boolean(databaseUrl);
}

export async function openDb(): Promise<AppDb> {
  if (db.isOpen()) {
    return db;
  }

  openPromise ??= db
    .open()
    .then(() => db)
    .catch((error) => {
      openPromise = undefined;
      throw error;
    });

  return await openPromise;
}

export async function syncDb(): Promise<void> {
  if (!cloudSyncEnabled) {
    return;
  }

  await openDb();
  await db.cloud.sync();
}

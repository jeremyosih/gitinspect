import Dexie, { type EntityTable, type Table } from "dexie";
import { DB_NAME, registerAppDbSchema } from "./schema";
import type {
  DailyCostAggregate,
  MessageRow,
  ProviderKeyRecord,
  RepositoryRow,
  SessionData,
  SessionLeaseRow,
  SessionRuntimeRow,
  SettingsRow,
} from "./types";

export class AppDb extends Dexie {
  dailyCosts!: EntityTable<DailyCostAggregate, "date">;
  messages!: EntityTable<MessageRow, "id">;
  providerKeys!: EntityTable<ProviderKeyRecord, "provider">;
  repositories!: Table<RepositoryRow, [string, string, string]>;
  sessionLeases!: EntityTable<SessionLeaseRow, "sessionId">;
  sessionRuntime!: EntityTable<SessionRuntimeRow, "sessionId">;
  sessions!: EntityTable<SessionData, "id">;
  settings!: EntityTable<SettingsRow, "key">;

  constructor(name = DB_NAME) {
    super(name);

    registerAppDbSchema(this);

    this.dailyCosts = this.table("daily_costs");
    this.messages = this.table("messages");
    this.providerKeys = this.table("provider-keys");
    this.repositories = this.table("repositories");
    this.sessionLeases = this.table("session_leases");
    this.sessionRuntime = this.table("session_runtime");
    this.sessions = this.table("sessions");
    this.settings = this.table("settings");
  }
}

export const db = new AppDb();

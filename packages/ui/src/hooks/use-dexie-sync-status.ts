import { db } from "@gitinspect/db";
import { useObservable } from "dexie-react-hooks";

export type DexieCloudUserStatus = {
  evalDaysLeft?: number;
  isLoggedIn?: boolean;
  userType?: "client" | "demo" | "eval" | "prod";
};

export type DexieCloudSyncState = {
  error?: Error;
  license?: "deactivated" | "expired" | "ok";
  phase?: "error" | "in-sync" | "initial" | "not-in-sync" | "offline" | "pulling" | "pushing";
  progress?: number;
  status?: "connected" | "connecting" | "disconnected" | "error" | "not-started" | "offline";
};

export function useDexieSyncStatus() {
  const currentUser = useObservable(db.cloud.currentUser) as DexieCloudUserStatus | undefined;
  const syncState = useObservable(db.cloud.syncState) as DexieCloudSyncState | undefined;
  const userStatus = currentUser ?? {};

  return {
    currentUser,
    evalDaysLeft: userStatus.evalDaysLeft,
    syncState,
    userType: userStatus.userType,
  };
}

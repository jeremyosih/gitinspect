import type { ResolvedRepoSource } from "./types";
import type { ChatMessage } from "@gitinspect/pi/types/chat";

export interface PublicSessionRecord {
  id: string;
  realmId: "rlm-public";
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  title: string;
  preview: string;
  messageCount: number;
  messageIds?: string[];
  sourceUrl?: string;
  repoSource?: Pick<ResolvedRepoSource, "owner" | "repo" | "ref" | "refOrigin" | "resolvedRef">;
  version: 1;
}

export interface PublicMessageRecord {
  id: string;
  realmId: "rlm-public";
  sessionId: string;
  order: number;
  timestamp: number;
  value: ChatMessage;
}

export interface ShareOwnerRecord {
  id: string;
  ownerUserId: string;
  realmId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSessionSnapshot {
  session: PublicSessionRecord;
  messages: PublicMessageRecord[];
}

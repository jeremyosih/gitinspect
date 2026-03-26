import type { TSchema } from "@sinclair/typebox"
import type { Message } from "@mariozechner/pi-ai"
import type {
  ProviderGroupId,
  ProviderId,
  ThinkingLevel,
} from "@/types/models"
import type { AssistantMessage } from "@/types/chat"

export interface ToolDefinition {
  description: string
  name: string
  parameters: TSchema
}

export interface StreamChatParams {
  apiKey?: string
  assistantId?: string
  assistantTimestamp?: number
  messages: Message[]
  model: string
  onTextDelta: (delta: string) => void
  provider: ProviderId
  providerGroup?: ProviderGroupId
  sessionId: string
  signal: AbortSignal
  thinkingLevel: ThinkingLevel
  tools: ToolDefinition[]
}

export interface StreamChatResult {
  assistantMessage: AssistantMessage
}

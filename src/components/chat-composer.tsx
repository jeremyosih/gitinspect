import * as React from "react"
import { ChatModelSelector } from "./chat-model-selector"
import type { ChatStatus } from "ai"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import { getModelForGroup } from "@/models/catalog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input"

const THINKING_LEVELS: Array<{ label: string; value: ThinkingLevel }> = [
  { label: "Off", value: "off" },
  { label: "Minimal", value: "minimal" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
]

function ChatComposerInner(props: {
  composerDisabled?: boolean
  isStreaming: boolean
  model: string
  onAbort: () => void
  onSelectModel: (
    providerGroup: ProviderGroupId,
    modelId: string
  ) => Promise<void> | void
  onSend: (value: string) => Promise<void> | void
  onThinkingLevelChange: (level: ThinkingLevel) => Promise<void> | void
  providerGroup: ProviderGroupId
  thinkingLevel: ThinkingLevel
}) {
  const { textInput } = usePromptInputController()
  const text = textInput.value
  const locked = props.composerDisabled === true

  const handleSubmit = React.useCallback(
    (message: PromptInputMessage) => {
      if (locked) {
        return
      }

      const next = message.text.trim()

      if (!next || props.isStreaming) {
        return
      }

      void props.onSend(next)
    },
    [locked, props.isStreaming, props.onSend]
  )

  const submitStatus: ChatStatus = props.isStreaming ? "streaming" : "ready"

  const currentModel = getModelForGroup(props.providerGroup, props.model)
  const supportsThinking = currentModel.reasoning === true
  const controlsDisabled = locked || props.isStreaming

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputHeader>
          <PromptInputAttachmentsRow />
        </PromptInputHeader>

        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-[4.5rem] text-sm font-medium leading-6 text-foreground placeholder:text-muted-foreground md:text-base"
            disabled={locked}
            placeholder={
              locked
                ? "Select a repository to get started"
                : "What would you like to know?"
            }
          />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger
                aria-label="Add attachments"
                disabled={locked}
                tooltip={{
                  content:
                    "Add files for local preview. Only message text is sent in this version.",
                }}
              />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
                <PromptInputActionAddScreenshot />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>

            <ChatModelSelector
              disabled={controlsDisabled}
              model={props.model}
              onSelect={props.onSelectModel}
              providerGroup={props.providerGroup}
            />

            {supportsThinking ? (
              <Select
                disabled={controlsDisabled}
                onValueChange={(value) => {
                  void props.onThinkingLevelChange(value as ThinkingLevel)
                }}
                value={props.thinkingLevel}
              >
                <SelectTrigger
                  aria-label="Thinking mode"
                  className="min-w-24"
                  size="sm"
                >
                  <SelectValue placeholder="Thinking" />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_LEVELS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </PromptInputTools>

          <PromptInputSubmit
            disabled={
              locked || (!text.trim() && !props.isStreaming)
            }
            onStop={props.onAbort}
            status={submitStatus}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}

function PromptInputAttachmentsRow() {
  const attachments = usePromptInputAttachments()

  if (attachments.files.length === 0) {
    return null
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((file) => (
        <Attachment
          data={file}
          key={file.id}
          onRemove={() => attachments.remove(file.id)}
        >
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  )
}

export function ChatComposer(props: {
  composerDisabled?: boolean
  initialInput?: string
  isStreaming: boolean
  model: string
  onAbort: () => void
  onSelectModel: (
    providerGroup: ProviderGroupId,
    modelId: string
  ) => Promise<void> | void
  onSend: (value: string) => Promise<void> | void
  onThinkingLevelChange: (level: ThinkingLevel) => Promise<void> | void
  providerGroup: ProviderGroupId
  thinkingLevel: ThinkingLevel
}) {
  return (
    <PromptInputProvider
      initialInput={props.initialInput}
      key={props.initialInput ?? ""}
    >
      <ChatComposerInner {...props} />
    </PromptInputProvider>
  )
}

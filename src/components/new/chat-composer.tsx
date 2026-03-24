import * as React from "react"
import type { ChatStatus } from "ai"
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input"
import { SpeechInput } from "@/components/ai-elements/speech-input"
import type { ProviderGroupId } from "@/types/models"
import { GlobeIcon } from "lucide-react"
import { ChatModelSelector } from "./chat-model-selector"

function ComposerSpeechControl(props: { disabled: boolean }) {
  const { textInput } = usePromptInputController()

  return (
    <SpeechInput
      className="size-8"
      disabled={props.disabled}
      onTranscriptionChange={(transcript) => {
        const cur = textInput.value
        textInput.setInput(cur ? `${cur} ${transcript}` : transcript)
      }}
      size="icon"
      type="button"
      variant="ghost"
    />
  )
}

function ChatComposerInner(props: {
  error?: string
  isStreaming: boolean
  model: string
  onAbort: () => void
  onSelectModel: (
    providerGroup: ProviderGroupId,
    modelId: string
  ) => Promise<void> | void
  onSend: (value: string) => Promise<void> | void
  providerGroup: ProviderGroupId
}) {
  const { textInput } = usePromptInputController()
  const text = textInput.value

  const handleSubmit = React.useEffectEvent(
    async (message: PromptInputMessage) => {
      const next = message.text.trim()

      if (!next || props.isStreaming) {
        return
      }

      await props.onSend(next)
    }
  )

  const submitStatus: ChatStatus = props.error
    ? "error"
    : props.isStreaming
      ? "streaming"
      : "ready"

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputHeader>
          <PromptInputAttachmentsRow />
        </PromptInputHeader>

        <PromptInputBody>
          <PromptInputTextarea placeholder="What would you like to know?" />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger
                aria-label="Add attachments"
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

            <ComposerSpeechControl disabled={props.isStreaming} />

            <PromptInputButton
              aria-label="Web search"
              disabled
              tooltip="Search is not available in this version."
              type="button"
            >
              <GlobeIcon className="size-4" />
            </PromptInputButton>

            <ChatModelSelector
              disabled={props.isStreaming}
              model={props.model}
              onSelect={props.onSelectModel}
              providerGroup={props.providerGroup}
            />
          </PromptInputTools>

          <PromptInputSubmit
            disabled={!text.trim() && !props.isStreaming}
            onStop={props.onAbort}
            status={submitStatus}
          />
        </PromptInputFooter>
      </PromptInput>

      {props.error ? (
        <div className="text-xs text-destructive">{props.error}</div>
      ) : null}
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
  error?: string
  isStreaming: boolean
  model: string
  onAbort: () => void
  onSelectModel: (
    providerGroup: ProviderGroupId,
    modelId: string
  ) => Promise<void> | void
  onSend: (value: string) => Promise<void> | void
  providerGroup: ProviderGroupId
}) {
  return (
    <PromptInputProvider>
      <ChatComposerInner {...props} />
    </PromptInputProvider>
  )
}

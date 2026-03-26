import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { CheckIcon } from "lucide-react"
import { db } from "@/db/schema"
import type { ProviderGroupId } from "@/types/models"
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector"
import { PromptInputButton } from "@/components/ai-elements/prompt-input"
import {
  getConnectedProviders,
  getDefaultModelForGroup,
  getModelForGroup,
  getModelsForGroup,
  getProviderGroupMetadata,
  getVisibleProviderGroups,
} from "@/models/catalog"
import { cn } from "@/lib/utils"

export function ChatModelSelector(props: {
  disabled?: boolean
  model: string
  onSelect: (providerGroup: ProviderGroupId, modelId: string) => void
  providerGroup: ProviderGroupId
}) {
  const [open, setOpen] = React.useState(false)
  const providerKeys = useLiveQuery(() => db.providerKeys.toArray(), []) ?? []
  const providerGroups = getVisibleProviderGroups(
    getConnectedProviders(providerKeys)
  )
  const activeProviderGroup = providerGroups.includes(props.providerGroup)
    ? props.providerGroup
    : providerGroups[0] ?? "opencode-free"
  const activeModelId =
    activeProviderGroup === props.providerGroup
      ? props.model
      : getDefaultModelForGroup(activeProviderGroup).id
  const selectedModel = getModelForGroup(activeProviderGroup, activeModelId)

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton disabled={props.disabled} type="button">
          <ModelSelectorLogo
            className="size-3.5 shrink-0"
            provider={selectedModel.provider}
          />
          <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
        </PromptInputButton>
      </ModelSelectorTrigger>

      <ModelSelectorContent className="max-h-[min(420px,70vh)]">
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          {providerGroups.map((groupId) => (
            <ModelSelectorGroup
              heading={getProviderGroupMetadata(groupId).label}
              key={groupId}
            >
              {getModelsForGroup(groupId).map((model) => {
                const value = `${groupId}:${model.id}`
                const isSelected =
                  groupId === activeProviderGroup && model.id === activeModelId

                return (
                  <ModelSelectorItem
                    className="gap-2"
                    key={value}
                    onSelect={() => {
                      props.onSelect(groupId, model.id)
                      setOpen(false)
                    }}
                    value={value}
                  >
                    <ModelSelectorLogo
                      className="size-3.5 shrink-0"
                      provider={model.provider}
                    />
                    <ModelSelectorName>{model.name}</ModelSelectorName>
                    <CheckIcon
                      className={cn(
                        "ml-auto size-4 shrink-0",
                        isSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </ModelSelectorItem>
                )
              })}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  )
}

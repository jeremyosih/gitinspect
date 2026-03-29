import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { useNavigate } from "@tanstack/react-router"
import { CheckIcon, Plus } from "lucide-react"
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
  ModelSelectorSeparator,
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
  const navigate = useNavigate()
  const providerKeys = useLiveQuery(() => db.providerKeys.toArray(), []) ?? []
  const connectedProviders = getConnectedProviders(providerKeys)
  const showAddProviderCta = connectedProviders.length === 0
  const providerGroups = getVisibleProviderGroups(connectedProviders)
  const activeProviderGroup = providerGroups.includes(props.providerGroup)
    ? props.providerGroup
    : providerGroups[0] ?? "fireworks-free"
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
                    {groupId === "fireworks-free" ? (
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                        <span className="truncate leading-tight">
                          {model.name}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">
                          Free (with limits)
                        </span>
                      </span>
                    ) : (
                      <ModelSelectorName>{model.name}</ModelSelectorName>
                    )}
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
          {showAddProviderCta ? (
            <>
              <ModelSelectorSeparator />
              <ModelSelectorGroup heading="More models">
                <ModelSelectorItem
                  className="gap-2"
                  onSelect={() => {
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        settings: "providers",
                      }),
                      to: ".",
                    })
                    setOpen(false)
                  }}
                  value="__add_provider__"
                >
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-left text-sm">Add provider</span>
                </ModelSelectorItem>
              </ModelSelectorGroup>
            </>
          ) : null}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  )
}

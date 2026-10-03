import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, Plus } from "lucide-react";
import { db } from "@gitinspect/db";
import type { ProviderGroupId } from "@gitinspect/runtime/types/models";
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
} from "@gitinspect/ui/components/ai-elements/model-selector";
import { PromptInputButton } from "@gitinspect/ui/components/ai-elements/prompt-input";
import {
  getConnectedProviders,
  getDefaultModelForGroup,
  getModelForGroup,
  getModelsForGroup,
  getProviderGroupMetadata,
  getVisibleProviderGroups,
} from "@gitinspect/runtime/models/catalog";
import { cn } from "@gitinspect/ui/lib/utils";

export function ChatModelSelector(props: {
  disabled?: boolean;
  model: string;
  onSelect: (providerGroup: ProviderGroupId, modelId: string) => void;
  providerGroup: ProviderGroupId;
}) {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const providerKeysResult = useLiveQuery(() => db.providerKeys.toArray(), []);
  const providerKeys = Array.isArray(providerKeysResult) ? providerKeysResult : [];
  const connectedProviders = getConnectedProviders(providerKeys);
  const showAddProviderCta = connectedProviders.length === 0;
  const providerGroups = getVisibleProviderGroups(connectedProviders);
  const activeProviderGroup = providerGroups.includes(props.providerGroup)
    ? props.providerGroup
    : (providerGroups[0] ?? "openai");
  const activeModelId =
    activeProviderGroup === props.providerGroup
      ? props.model
      : getDefaultModelForGroup(activeProviderGroup).id;
  if (showAddProviderCta)
    return (
      <PromptInputButton
        disabled={props.disabled}
        onClick={() => {
          void navigate({
            to: ".",
            search: (previous) => ({ ...previous, settings: "providers" }),
          });
        }}
        type="button"
      >
        <Plus className="size-3.5" />
        Add AI provider
      </PromptInputButton>
    );
  const selectedModel = getModelForGroup(activeProviderGroup, activeModelId);

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton disabled={props.disabled} type="button">
          <ModelSelectorLogo className="size-3.5 shrink-0" provider={selectedModel.provider} />
          <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
        </PromptInputButton>
      </ModelSelectorTrigger>

      <ModelSelectorContent className="max-h-[min(420px,70vh)]">
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          {providerGroups.map((groupId) => (
            <ModelSelectorGroup heading={getProviderGroupMetadata(groupId).label} key={groupId}>
              {getModelsForGroup(groupId).map((model) => {
                const value = `${groupId}:${model.id}`;
                const isSelected = groupId === activeProviderGroup && model.id === activeModelId;

                return (
                  <ModelSelectorItem
                    className="gap-2"
                    key={value}
                    onSelect={() => {
                      props.onSelect(groupId, model.id);
                      setOpen(false);
                    }}
                    value={value}
                  >
                    <ModelSelectorLogo className="size-3.5 shrink-0" provider={model.provider} />
                    <ModelSelectorName>{model.name}</ModelSelectorName>
                    <CheckIcon
                      className={cn(
                        "ml-auto size-4 shrink-0",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

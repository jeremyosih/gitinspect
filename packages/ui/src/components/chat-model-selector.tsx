import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, Lock, Plus } from "lucide-react";
import { db } from "@gitinspect/db/schema";
import type { ProviderGroupId } from "@gitinspect/pi/types/models";
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
} from "@gitinspect/ui/components/ai-elements/model-selector";
import { PromptInputButton } from "@gitinspect/ui/components/ai-elements/prompt-input";
import {
  getConnectedProviders,
  getDefaultModelForGroup,
  getModelForGroup,
  getModelsForGroup,
  getProviderGroupMetadata,
  getVisibleProviderGroups,
} from "@gitinspect/pi/models/catalog";
import { useGitHubAuthContext } from "@gitinspect/ui/components/github-auth-context";
import { cn } from "@gitinspect/ui/lib/utils";

export function ChatModelSelector(props: {
  disabled?: boolean;
  model: string;
  onSelect: (providerGroup: ProviderGroupId, modelId: string) => void;
  providerGroup: ProviderGroupId;
}) {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const auth = useGitHubAuthContext();
  const providerKeysResult = useLiveQuery(() => db.providerKeys.toArray(), []);
  const providerKeys = Array.isArray(providerKeysResult) ? providerKeysResult : [];
  const connectedProviders = getConnectedProviders(providerKeys);
  const showAddProviderCta = connectedProviders.length === 0;
  const gitinspectModelsUnlocked = auth?.authState.session === "signed-in";
  const providerGroups = getVisibleProviderGroups(connectedProviders);
  const activeProviderGroup = providerGroups.includes(props.providerGroup)
    ? props.providerGroup
    : (providerGroups[0] ?? "fireworks-free");
  const activeModelId =
    activeProviderGroup === props.providerGroup
      ? props.model
      : getDefaultModelForGroup(activeProviderGroup).id;
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
                const isLockedGitinspect =
                  groupId === "fireworks-free" && !gitinspectModelsUnlocked;

                return (
                  <ModelSelectorItem
                    className={cn("gap-2", isLockedGitinspect ? "opacity-75" : undefined)}
                    key={value}
                    onSelect={() => {
                      if (isLockedGitinspect) {
                        auth?.openAuthDialog({ mode: "github-only" });
                        setOpen(false);
                        return;
                      }

                      props.onSelect(groupId, model.id);
                      setOpen(false);
                    }}
                    value={value}
                  >
                    <ModelSelectorLogo className="size-3.5 shrink-0" provider={model.provider} />
                    {groupId === "fireworks-free" ? (
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                        <span className="truncate leading-tight">{model.name}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {gitinspectModelsUnlocked
                            ? "Free (with limits)"
                            : "Sign in with GitHub to use"}
                        </span>
                      </span>
                    ) : (
                      <ModelSelectorName>{model.name}</ModelSelectorName>
                    )}
                    {isLockedGitinspect ? (
                      <Lock className="ml-auto size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <CheckIcon
                        className={cn(
                          "ml-auto size-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                    )}
                  </ModelSelectorItem>
                );
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
                    });
                    setOpen(false);
                  }}
                  value="__add_provider__"
                >
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="text-sm">Add AI provider</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      Use your own model without signing in.
                    </span>
                  </span>
                </ModelSelectorItem>
              </ModelSelectorGroup>
            </>
          ) : null}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

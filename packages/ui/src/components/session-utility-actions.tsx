import { MoreHorizontal, Unlink2 } from "lucide-react";
import { Button } from "@gitinspect/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gitinspect/ui/components/dropdown-menu";
import { Icons } from "@gitinspect/ui/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@gitinspect/ui/components/tooltip";

type SessionUtilityActionProps = {
  canUnshare: boolean;
  disabled?: boolean;
  isPro: boolean;
  isShared: boolean;
  isSharing?: boolean;
  onCopy: () => void;
  onShareToggle: () => void;
  onUpgradeClick: () => void;
};

function ShareButtonLabel(
  props: Pick<SessionUtilityActionProps, "canUnshare" | "isShared" | "isSharing">,
) {
  const isUnshareAction = props.isShared && props.canUnshare;

  if (props.isSharing) {
    return isUnshareAction ? "Unsharing..." : "Sharing...";
  }

  return isUnshareAction ? "Unshare" : "Share";
}

function ShareButtonIcon(props: Pick<SessionUtilityActionProps, "canUnshare" | "isShared">) {
  return props.isShared && props.canUnshare ? (
    <Unlink2 className="size-3.5" />
  ) : (
    <Icons.Globe className="size-3.5" />
  );
}

function ShareActionButton(props: SessionUtilityActionProps) {
  const button = (
    <Button
      className="h-7 gap-1.5 rounded-sm border border-border/50 bg-muted px-2 py-1 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground"
      disabled={props.disabled || props.isSharing}
      onClick={() => {
        if (!props.isPro) {
          props.onUpgradeClick();
          return;
        }

        props.onShareToggle();
      }}
      size="sm"
      type="button"
      variant="ghost"
    >
      <ShareButtonIcon canUnshare={props.canUnshare} isShared={props.isShared} />
      <span>
        <ShareButtonLabel
          canUnshare={props.canUnshare}
          isShared={props.isShared}
          isSharing={props.isSharing}
        />
      </span>
    </Button>
  );

  if (props.isPro) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent sideOffset={6}>Pro users only</TooltipContent>
    </Tooltip>
  );
}

export function SessionUtilityActions(props: SessionUtilityActionProps) {
  const shareLabel = (
    <ShareButtonLabel
      canUnshare={props.canUnshare}
      isShared={props.isShared}
      isSharing={props.isSharing}
    />
  );

  return (
    <>
      <div className="hidden items-center gap-2 md:flex">
        <Button
          className="h-7 gap-1.5 rounded-sm border border-border/50 bg-muted px-2 py-1 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground"
          disabled={props.disabled}
          onClick={props.onCopy}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Icons.copy className="size-3.5" />
          <span>Copy as Markdown</span>
        </Button>
        <ShareActionButton {...props} />
      </div>

      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Open session actions"
              className="h-8 w-8 rounded-sm"
              disabled={props.disabled}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={props.onCopy}>
              <Icons.copy className="size-4" />
              <span>Copy as Markdown</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={props.isSharing || (!props.isPro && props.disabled)}
              onClick={() => {
                if (!props.isPro) {
                  props.onUpgradeClick();
                  return;
                }

                props.onShareToggle();
              }}
            >
              <ShareButtonIcon canUnshare={props.canUnshare} isShared={props.isShared} />
              <span>{shareLabel}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

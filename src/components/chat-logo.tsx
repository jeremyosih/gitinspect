import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@/lib/utils"

type ChatLogoProps = ComponentPropsWithoutRef<"div"> & {
  /** Larger wordmark for landing / hero layouts */
  size?: "default" | "hero"
}

export function ChatLogo({
  className,
  size = "default",
  ...props
}: ChatLogoProps) {
  return (
    <div
      className={cn("flex w-full items-center justify-center", className)}
      {...props}
    >
      <div
        className={cn(
          "font-geist-pixel-square flex items-baseline gap-0.5 text-center leading-none font-semibold tracking-tight",
          size === "hero"
            ? "gap-1 text-5xl sm:text-6xl md:text-7xl lg:text-8xl"
            : "gap-0.5 text-lg md:text-2xl"
        )}
      >
        <span className="text-muted-foreground">git</span>
        <span className="text-foreground">inspect</span>
      </div>
    </div>
  )
}

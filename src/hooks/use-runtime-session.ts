import * as React from "react"
import { getRuntimeCommandErrorMessage } from "@/agent/runtime-command-errors"
import { runtimeClient } from "@/agent/runtime-client"

export function useRuntimeSession(sessionId: string | undefined) {
  const [actionError, setActionError] = React.useState<string | undefined>(undefined)

  const runMutation = React.useEffectEvent(
    async (action: (currentSessionId: string) => Promise<void>) => {
      if (!sessionId) {
        return
      }

      setActionError(undefined)

      try {
        await action(sessionId)
      } catch (error) {
        setActionError(
          getRuntimeCommandErrorMessage(
            error instanceof Error ? error : undefined
          )
        )
      }
    }
  )

  const send = React.useEffectEvent(async (content: string) => {
    await runMutation(async (currentSessionId) => {
      await runtimeClient.send(currentSessionId, content)
    })
  })

  const abort = React.useEffectEvent(async () => {
    if (!sessionId) {
      return
    }

    setActionError(undefined)
    await runtimeClient.abort(sessionId)
  })

  const setModelSelection = React.useEffectEvent(
    async (
      providerGroup: Parameters<typeof runtimeClient.setModelSelection>[1],
      model: string
    ) => {
      await runMutation(async (currentSessionId) => {
        await runtimeClient.setModelSelection(
          currentSessionId,
          providerGroup,
          model
        )
      })
    }
  )

  const setThinkingLevel = React.useEffectEvent(
    async (
      thinkingLevel: Parameters<typeof runtimeClient.setThinkingLevel>[1]
    ) => {
      await runMutation(async (currentSessionId) => {
        await runtimeClient.setThinkingLevel(
          currentSessionId,
          thinkingLevel
        )
      })
    }
  )

  return {
    abort,
    error: actionError,
    send,
    setModelSelection,
    setThinkingLevel,
  }
}

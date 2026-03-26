import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import { AgentHost } from "@/agent/agent-host"
import {
  BusyRuntimeError,
  MissingSessionRuntimeError,
} from "@/agent/runtime-command-errors"
import { getGithubPersonalAccessToken } from "@/repo/github-token"
import { loadSessionWithMessages } from "@/sessions/session-service"

export class SessionRuntimeRegistry {
  private readonly sessionHosts = new Map<string, AgentHost>()

  private async getOrCreateHost(
    sessionId: string
  ): Promise<AgentHost | undefined> {
    if (this.sessionHosts.has(sessionId)) {
      return this.sessionHosts.get(sessionId)
    }

    const loaded = await loadSessionWithMessages(sessionId)

    if (!loaded) {
      return undefined
    }

    const githubRuntimeToken = await getGithubPersonalAccessToken()
    const host = new AgentHost(loaded.session, loaded.messages, {
      getGithubToken: getGithubPersonalAccessToken,
      githubRuntimeToken,
    })
    this.sessionHosts.set(
      sessionId,
      host
    )

    return host
  }

  private async getHostForCommand(
    sessionId: string,
    options: {
      requireIdle?: boolean
    } = {}
  ): Promise<AgentHost> {
    const host = await this.getOrCreateHost(sessionId)

    if (!host) {
      throw new MissingSessionRuntimeError(sessionId)
    }

    if (options.requireIdle && host.isBusy()) {
      throw new BusyRuntimeError(sessionId)
    }

    return host
  }

  async ensureSession(sessionId: string): Promise<boolean> {
    return (await this.getOrCreateHost(sessionId)) !== undefined
  }

  async send(
    sessionId: string,
    content: string
  ): Promise<void> {
    const host = await this.getHostForCommand(sessionId, { requireIdle: true })
    await host.prompt(content)
  }

  async abort(sessionId: string): Promise<void> {
    const host = await this.getOrCreateHost(sessionId)
    host?.abort()
  }

  releaseSession(sessionId: string): void {
    const host = this.sessionHosts.get(sessionId)

    if (!host) {
      return
    }

    host.dispose()
    this.sessionHosts.delete(sessionId)
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    const host = await this.getHostForCommand(sessionId, { requireIdle: true })
    await host.setModelSelection(providerGroup, modelId)
  }

  async refreshGithubToken(
    sessionId: string
  ): Promise<void> {
    const host = await this.getHostForCommand(sessionId, { requireIdle: true })
    await host.refreshGithubToken()
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<void> {
    const host = await this.getHostForCommand(sessionId, { requireIdle: true })
    await host.setThinkingLevel(thinkingLevel)
  }

  dispose(): void {
    for (const host of this.sessionHosts.values()) {
      host.dispose()
    }

    this.sessionHosts.clear()
  }
}

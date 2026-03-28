import { expose } from "comlink"
import * as api from "@/agent/runtime-worker-api"

const scope = globalThis as typeof globalThis & {
  addEventListener: (
    type: string,
    listener: (event: MessageEvent) => void
  ) => void
  onconnect?: unknown
}

if ("onconnect" in scope) {
  scope.addEventListener("connect", (event) => {
    const connectEvent = event as MessageEvent & { ports: Array<MessagePort> }
    const [port] = connectEvent.ports

    if (!port) {
      return
    }

    expose(api, port)
    port.start?.()
  })
} else {
  expose(api)
}

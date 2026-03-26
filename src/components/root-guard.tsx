import type { ReactNode } from "react"

export function RootGuard(props: {
  children: ReactNode
}) {
  return <>{props.children}</>
}

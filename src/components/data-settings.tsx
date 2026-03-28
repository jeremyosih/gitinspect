"use client"

import * as React from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { toast } from "sonner"
import { Download, Trash2 } from "lucide-react"
import { runtimeClient } from "@/agent/runtime-client"
import {
  deleteAllLocalData,
  exportAllChatData,
  listSessions,
} from "@/db/schema"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { useCurrentRouteTarget } from "@/hooks/use-current-route-target"

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function DataSettings() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const currentRouteTarget = useCurrentRouteTarget()
  const sidebar = search.sidebar === "open" ? "open" : undefined
  const initialQuery =
    typeof search.initialQuery === "string" ? search.initialQuery : undefined
  const [isExporting, setIsExporting] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)

  const navigateAfterWipe = React.useCallback(() => {
    if (currentRouteTarget.to === "/") {
      void navigate({
        to: "/",
        search: {
          ...search,
          settings: undefined,
          sidebar,
        },
      })
      return
    }

    void navigate({
      ...currentRouteTarget,
      search: {
        initialQuery: undefined,
        session: undefined,
        settings: undefined,
        sidebar,
      },
    })
  }, [currentRouteTarget, navigate, search, sidebar])

  const handleExport = React.useCallback(async () => {
    setIsExporting(true)
    try {
      const payload = await exportAllChatData()
      const day = payload.exportedAt.slice(0, 10)
      downloadJson(`gitinspect-chat-export-${day}.json`, payload)
      toast.success("Chat data exported")
    } catch (error) {
      console.error(error)
      toast.error("Could not export chat data")
    } finally {
      setIsExporting(false)
    }
  }, [])

  const handleDeleteAll = React.useCallback(async () => {
    setIsDeleting(true)
    try {
      const sessions = await listSessions()
      for (const session of sessions) {
        try {
          await runtimeClient.releaseSession(session.id)
        } catch {
          // Best-effort worker teardown.
        }
      }
      await deleteAllLocalData()
      toast.success("All local data removed from this browser")
      navigateAfterWipe()
    } catch (error) {
      console.error(error)
      toast.error("Could not delete local data")
    } finally {
      setIsDeleting(false)
    }
  }, [navigateAfterWipe])

  return (
    <div className="space-y-4">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>Export chat as JSON</ItemTitle>
          <ItemDescription>
            Download every session and message stored locally. Use it for your
            own backup or to move data between profiles manually.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            disabled={isExporting}
            onClick={() => void handleExport()}
            size="sm"
            variant="outline"
          >
            <Download className="size-4" />
            {isExporting ? "Exporting…" : "Export"}
          </Button>
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemContent>
          <ItemTitle>Delete all local data</ItemTitle>
          <ItemDescription>
            Remove everything stored in this browser: chats, recent repos,
            provider keys and OAuth, app settings (including proxy), and usage /
            cost history.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={isDeleting}
                size="sm"
                variant="outline"
              >
                <Trash2 className="size-4" />
                {isDeleting ? "Deleting…" : "Delete all"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all local data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This wipes chats, repositories, credentials, settings, and
                  usage totals from IndexedDB. It cannot be undone. Export chat
                  JSON first if you want a transcript backup.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => void handleDeleteAll()}
                >
                  Delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </ItemActions>
      </Item>
    </div>
  )
}

import { type Component, For, Show, createMemo } from "solid-js"
import type { PluginUiRow } from "@opencode-ai/sdk/v2/client"
import { ExternalLink } from "@/components/external-link"
import { useServerSync, type PluginUiEntry } from "@/context/server-sync"

const TONE: Record<string, string> = {
  base: "text-text-base",
  muted: "text-v2-text-text-muted",
  success: "text-v2-state-fg-success",
  warning: "text-v2-state-fg-warning",
  danger: "text-v2-state-fg-danger",
}

/**
 * Renders declarative widgets published by server plugins into a named host
 * slot, e.g. `sidebar.footer`. Rows are data (text, progress, http(s) link);
 * plugins never run code in this renderer.
 */
export const PluginSlot: Component<{ name: string; class?: string }> = (props) => {
  const serverSync = useServerSync()
  const entries = createMemo(() => serverSync().pluginUi.slot(props.name))

  return (
    <Show when={entries().length > 0}>
      <div class={`flex flex-col gap-2 ${props.class ?? ""}`} data-component="plugin-slot">
        <For each={entries()}>{(entry) => <PluginWidget entry={entry} />}</For>
      </div>
    </Show>
  )
}

export const PluginWidget: Component<{ entry: PluginUiEntry }> = (props) => {
  return (
    <div class="rounded-xl bg-background-base shadow-xs-border-base" data-component="plugin-widget">
      <div class="p-3 flex flex-col gap-2">
        <Show when={props.entry.widget.title}>
          {(title) => <div class="text-12-medium text-text-strong">{title()}</div>}
        </Show>
        <For each={props.entry.widget.rows}>
          {(row) =>
            row.type === "progress" ? (
              <ProgressRow row={row} />
            ) : row.type === "link" ? (
              <LinkRow row={row} />
            ) : (
              <TextRow row={row} />
            )
          }
        </For>
      </div>
    </div>
  )
}

function TextRow(props: { row: Extract<PluginUiRow, { type: "text" }> }) {
  return <div class={`text-12-regular ${TONE[props.row.tone ?? "base"]}`}>{props.row.text}</div>
}

// Plugin data crosses from the server into the app renderer, so only http(s)
// links are navigable: a `javascript:` or `data:` href would execute here.
export function isSafeHref(href: string) {
  return /^https?:\/\//i.test(href)
}

function LinkRow(props: { row: Extract<PluginUiRow, { type: "link" }> }) {
  return (
    <Show
      when={isSafeHref(props.row.href)}
      fallback={<span class="text-12-regular text-text-base">{props.row.label}</span>}
    >
      <ExternalLink class="text-12-regular" href={props.row.href}>
        {props.row.label}
      </ExternalLink>
    </Show>
  )
}

function ProgressRow(props: { row: Extract<PluginUiRow, { type: "progress" }> }) {
  const percent = createMemo(() => Math.max(0, Math.min(100, props.row.percent)))
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-2 text-12-regular">
        <span class="text-text-base truncate">{props.row.label}</span>
        <span class="text-v2-text-text-muted shrink-0" style={{ "font-variant-numeric": "tabular-nums" }}>
          {props.row.detail ?? `${percent()}%`}
        </span>
      </div>
      <div class="h-1 w-full overflow-hidden rounded-full bg-border-base">
        <div class="h-full rounded-full bg-text-base" style={{ width: `${percent()}%` }} />
      </div>
    </div>
  )
}

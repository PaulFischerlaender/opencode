import { type Component, For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { useSettingsDialog } from "@/components/settings-dialog"
import { useTitlebarRightMount } from "@/components/titlebar"
import { PluginWidget } from "@/components/plugin-slot"
import { isLocalPlugin, packageName, pluginSpecifier } from "@/components/settings-v2/plugins-model"

/**
 * Titlebar button and command that open the plugin drawer. Mounted once in the
 * app shell so every session can reach it.
 */
export const PluginDrawerToggle: Component<{ open: boolean; onToggle: () => void }> = (props) => {
  const command = useCommand()
  const language = useLanguage()
  const mount = useTitlebarRightMount()

  command.register("plugin-drawer", () => [
    {
      id: "plugin.drawer.toggle",
      title: language.t("plugin.drawer.toggle"),
      category: language.t("settings.plugins.title"),
      keybind: "mod+p",
      onSelect: () => props.onToggle(),
    },
  ])

  return (
    <Show when={mount()} keyed>
      {(target) => (
        <Portal mount={target}>
          <TooltipV2
            placement="bottom"
            value={
              <>
                {language.t("plugin.drawer.toggle")}
                <KeybindV2 keys={command.keybindParts("plugin.drawer.toggle")} variant="neutral" />
              </>
            }
          >
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="large"
              class="titlebar-icon [&_[data-slot=icon-svg]]:text-v2-icon-icon-muted"
              icon={<IconV2 name="sidebar-right" />}
              state={props.open ? "pressed" : undefined}
              onClick={() => props.onToggle()}
              aria-label={language.t("plugin.drawer.toggle")}
              aria-pressed={props.open}
            />
          </TooltipV2>
        </Portal>
      )}
    </Show>
  )
}

/**
 * Slide-over listing every widget published by plugins on the active server.
 * Rendered inside the app's content area so it never covers the titlebar.
 */
export const PluginDrawer: Component<{ open: boolean; onClose: () => void }> = (props) => {
  const language = useLanguage()
  const serverSync = useServerSync()
  const openSettings = useSettingsDialog("plugins")
  const entries = createMemo(() => serverSync().pluginUi.all())
  const errors = createMemo(() => serverSync().pluginUi.errors())
  // Installed npm plugins that publish nothing, so an install that only wires up
  // server hooks is visibly accounted for instead of looking broken.
  const silent = createMemo(() => {
    const published = new Set(entries().map((entry) => entry.plugin))
    const errored = new Set(errors().map((entry) => packageName(entry.plugin)))
    return (serverSync().data.config.plugin ?? [])
      .map(pluginSpecifier)
      .filter((spec) => !isLocalPlugin(spec))
      .map(packageName)
      .filter((name) => !published.has(name) && !errored.has(name))
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") props.onClose()
  }
  onMount(() => window.addEventListener("keydown", onKeyDown))
  onCleanup(() => window.removeEventListener("keydown", onKeyDown))

  return (
    <Show when={props.open}>
      <div class="absolute inset-0 z-40" data-component="plugin-drawer">
        <div class="absolute inset-0 bg-black/25" onClick={() => props.onClose()} />
        <aside
          class="absolute inset-y-0 end-0 flex w-[360px] max-w-[90vw] flex-col bg-v2-background-bg-base border-s border-v2-border-border-base shadow-[var(--v2-elevation-raised)]"
          aria-label={language.t("settings.plugins.title")}
        >
          <div class="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-v2-border-border-base">
            <span class="text-14-medium text-v2-text-text-base">{language.t("settings.plugins.title")}</span>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="xmark-small" />}
              onClick={() => props.onClose()}
              aria-label={language.t("common.close")}
            />
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
            <Show when={errors().length > 0}>
              <div class="flex flex-col gap-2" data-component="plugin-errors">
                <span class="text-12-medium text-v2-text-text-muted">{language.t("plugin.drawer.errors")}</span>
                <For each={errors()}>
                  {(entry) => (
                    <div class="flex flex-col gap-1 rounded-xl bg-background-base p-3 shadow-xs-border-base">
                      <span class="text-12-medium text-v2-text-text-base truncate">{entry.plugin}</span>
                      <span class="text-12-regular text-v2-state-fg-danger break-words">{entry.message}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show
              when={entries().length > 0}
              fallback={
                <div class="flex flex-col items-start gap-3">
                  <div class="text-12-regular text-v2-text-text-muted">{language.t("plugin.drawer.empty")}</div>
                  <ButtonV2 size="normal" variant="neutral" icon="settings-gear" onClick={openSettings}>
                    {language.t("plugin.drawer.openSettings")}
                  </ButtonV2>
                </div>
              }
            >
              <For each={entries()}>
                {(entry) => (
                  <div class="flex flex-col gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-12-medium text-v2-text-text-muted truncate">{entry.plugin}</span>
                      <span class="text-11-regular text-v2-text-text-faint truncate">{entry.slot}</span>
                    </div>
                    <PluginWidget entry={entry} />
                  </div>
                )}
              </For>
            </Show>
            <Show when={silent().length > 0}>
              <div class="flex flex-col gap-1 border-t border-v2-border-border-base pt-4">
                <For each={silent()}>
                  {(name) => (
                    <div class="flex items-center justify-between gap-2 min-w-0">
                      <span class="text-12-regular text-v2-text-text-muted truncate">{name}</span>
                      <span class="text-11-regular text-v2-text-text-faint shrink-0">
                        {language.t("plugin.drawer.noWidgets")}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </aside>
      </div>
    </Show>
  )
}

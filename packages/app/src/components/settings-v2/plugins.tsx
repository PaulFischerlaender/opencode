import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { showToast } from "@/utils/toast"
import { type Component, For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerProtocol } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { SettingsListV2 } from "./parts/list"
import { isLocalPlugin, packageName, pluginHits, pluginSearchUrl, pluginSpecifier, type PluginHit } from "./plugins-model"
import "./settings-v2.css"

const SEARCH_DEBOUNCE = 300

export const SettingsPluginsV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const protocol = useServerProtocol()
  const serverSync = useServerSync()
  const fetcher = platform.fetch ?? globalThis.fetch
  const [store, setStore] = createStore<{ query: string; loading: boolean; failed: boolean; hits: PluginHit[] }>({
    query: "",
    loading: true,
    failed: false,
    hits: [],
  })

  const specs = createMemo(() => serverSync().data.config.plugin ?? [])
  const installed = createMemo(() => new Set(specs().map((item) => packageName(pluginSpecifier(item)))))
  const isInstalled = (name: string) => installed().has(name)

  let timer: ReturnType<typeof setTimeout> | undefined
  let request = 0
  onCleanup(() => clearTimeout(timer))

  const search = (query: string) => {
    setStore("query", query)
    clearTimeout(timer)
    timer = setTimeout(() => void load(query), SEARCH_DEBOUNCE)
  }

  const load = async (query: string) => {
    const id = ++request
    setStore("loading", true)
    setStore("failed", false)
    const response = await fetcher(pluginSearchUrl(query)).catch(() => undefined)
    if (id !== request) return
    const body: unknown = response?.ok ? await response.json().catch(() => undefined) : undefined
    if (id !== request) return
    const hits = pluginHits(body)
    setStore({ loading: false, failed: hits === undefined, hits: hits ?? [] })
  }

  onMount(() => void load(""))

  const write = async (next: ReturnType<typeof specs>, before: ReturnType<typeof specs>) => {
    serverSync().set("config", "plugin", next)
    return serverSync()
      .updateConfig({ plugin: next })
      .then(
        () => true,
        (error: unknown) => {
          serverSync().set("config", "plugin", before)
          showToast({
            title: language.t("common.requestFailed"),
            description: error instanceof Error ? error.message : String(error),
          })
          return false
        },
      )
  }

  const install = async (hit: PluginHit) => {
    if (protocol() !== "v1") return
    const before = specs()
    if (!(await write([...before, hit.name], before))) return
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.plugins.installed.toast.title"),
      description: language.t("settings.plugins.installed.toast.description", { plugin: hit.name }),
    })
  }

  const remove = async (spec: string) => {
    if (protocol() !== "v1") return
    const before = specs()
    const name = packageName(spec)
    await write(
      before.filter((item) => packageName(pluginSpecifier(item)) !== name),
      before,
    )
  }

  const openNpm = (name: string) => {
    platform.openExternal(`https://www.npmjs.com/package/${name}`)
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked settings-v2-plugins-header">
        <div class="settings-v2-tab-header-row">
          <div class="settings-v2-plugins-heading">
            <h2 class="settings-v2-tab-title">{language.t("settings.plugins.title")}</h2>
            <p class="settings-v2-plugins-description">{language.t("settings.plugins.description")}</p>
          </div>
        </div>
        <div class="settings-v2-tab-search">
          <TextInputV2
            type="search"
            appearance="base"
            value={store.query}
            onInput={(event) => search(event.currentTarget.value)}
            leadingIcon={<IconV2 name="magnifying-glass" size="large" class="text-v2-icon-icon-muted" />}
            placeholder={language.t("settings.plugins.search.placeholder")}
            clearLabel={language.t("common.clear")}
            showClearButton={store.query.length > 0}
            onClearClick={() => search("")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            aria-label={language.t("settings.plugins.search.placeholder")}
          />
        </div>
      </div>

      <div class="settings-v2-tab-body settings-v2-plugins">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.plugins.section.installed")}</h3>
          <SettingsListV2>
            <Show
              when={specs().length > 0}
              fallback={<div class="settings-v2-plugins-empty">{language.t("settings.plugins.installed.empty")}</div>}
            >
              <For each={specs()}>
                {(spec) => {
                  const value = pluginSpecifier(spec)
                  return (
                    <div class="settings-v2-plugins-row">
                      <div class="settings-v2-plugins-copy">
                        <div class="settings-v2-plugins-main">
                          <span class="settings-v2-plugins-name">{packageName(value)}</span>
                          <Show when={isLocalPlugin(value)}>
                            <Tag>{language.t("settings.plugins.local")}</Tag>
                          </Show>
                          <Show when={!isLocalPlugin(value) && value !== packageName(value)}>
                            <Tag>{value.slice(packageName(value).length + 1)}</Tag>
                          </Show>
                        </div>
                      </div>
                      <ButtonV2 size="normal" variant="ghost-muted" onClick={() => void remove(value)}>
                        {language.t("common.delete")}
                      </ButtonV2>
                    </div>
                  )
                }}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.plugins.section.browse")}</h3>
          <SettingsListV2>
            <Show
              when={!store.failed}
              fallback={<div class="settings-v2-plugins-empty">{language.t("settings.plugins.search.error")}</div>}
            >
              <Show
                when={store.hits.length > 0}
                fallback={
                  <div class="settings-v2-plugins-empty">
                    {store.loading ? language.t("common.loading") : language.t("settings.plugins.search.empty")}
                  </div>
                }
              >
                <For each={store.hits}>
                  {(hit) => (
                    <div class="settings-v2-plugins-row">
                      <div class="settings-v2-plugins-copy">
                        <div class="settings-v2-plugins-main">
                          <button
                            type="button"
                            class="settings-v2-plugins-name settings-v2-plugins-link"
                            onClick={() => openNpm(hit.name)}
                          >
                            {hit.name}
                          </button>
                          <Show when={hit.version}>
                            {(version) => <Tag>v{version()}</Tag>}
                          </Show>
                        </div>
                        <Show when={hit.description}>
                          {(description) => <p class="settings-v2-plugins-description">{description()}</p>}
                        </Show>
                        <Show when={hit.publisher}>
                          {(publisher) => <span class="settings-v2-plugins-meta">{publisher()}</span>}
                        </Show>
                      </div>
                      <Show when={!isInstalled(hit.name)}>
                        <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => void install(hit)}>
                          {language.t("settings.plugins.install")}
                        </ButtonV2>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}


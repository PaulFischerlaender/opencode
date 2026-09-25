import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { showToast } from "@/utils/toast"
import { type Component, For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerProtocol } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { SettingsListV2 } from "./parts/list"
import {
  formatDownloads,
  isExactVersion,
  isLocalPlugin,
  packageName,
  PLUGIN_SEARCH_SIZE,
  pluginHits,
  pluginSearchUrl,
  pluginSpecifier,
  pluginTotal,
  pluginVersion,
  sortPluginHits,
  type PluginHit,
  type PluginSort,
} from "./plugins-model"
import "./settings-v2.css"

const SEARCH_DEBOUNCE = 300

export const SettingsPluginsV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const protocol = useServerProtocol()
  const serverSync = useServerSync()
  const fetcher = platform.fetch ?? globalThis.fetch
  const [store, setStore] = createStore<{
    query: string
    spec: string
    loading: boolean
    loadingMore: boolean
    failed: boolean
    hits: PluginHit[]
    offset: number
    total: number
    sort: PluginSort
  }>({
    query: "",
    spec: "",
    loading: true,
    loadingMore: false,
    failed: false,
    hits: [],
    offset: 0,
    total: 0,
    sort: "relevance",
  })

  const specs = createMemo(() => serverSync().data.config.plugin ?? [])
  const installed = createMemo(() => new Set(specs().map((item) => packageName(pluginSpecifier(item)))))
  const isInstalled = (name: string) => installed().has(name)
  const hits = createMemo(() => sortPluginHits(store.hits, store.sort))
  const hasMore = createMemo(() => store.hits.length > 0 && store.offset < store.total)

  let timer: ReturnType<typeof setTimeout> | undefined
  let request = 0
  onCleanup(() => clearTimeout(timer))

  const search = (query: string) => {
    setStore("query", query)
    clearTimeout(timer)
    timer = setTimeout(() => void load(query), SEARCH_DEBOUNCE)
  }

  const load = async (query: string, from = 0) => {
    const id = ++request
    setStore(from === 0 ? "loading" : "loadingMore", true)
    setStore("failed", false)
    const response = await fetcher(pluginSearchUrl(query, from)).catch(() => undefined)
    if (id !== request) return
    const body: unknown = response?.ok ? await response.json().catch(() => undefined) : undefined
    if (id !== request) return
    const page = pluginHits(body)
    if (page === undefined) {
      setStore({ loading: false, loadingMore: false, failed: true, hits: [], offset: 0, total: 0 })
      return
    }
    const before = from === 0 ? [] : store.hits
    const seen = new Set(before.map((hit) => hit.name))
    const merged = from === 0 ? page : [...before, ...page.filter((hit) => !seen.has(hit.name))]
    setStore({
      loading: false,
      loadingMore: false,
      failed: false,
      hits: merged,
      offset: from + PLUGIN_SEARCH_SIZE,
      total: pluginTotal(body) ?? 0,
    })
  }

  const loadMore = () => {
    if (store.loading || store.loadingMore) return
    void load(store.query, store.offset)
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

  const install = async (spec: string) => {
    if (protocol() !== "v1") return
    const before = specs()
    if (!(await write([...before, spec], before))) return
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.plugins.installed.toast.title"),
      description: language.t("settings.plugins.installed.toast.description", { plugin: spec }),
    })
  }

  const installSpec = async () => {
    const spec = store.spec.trim()
    if (!spec) return
    await install(spec)
    setStore("spec", "")
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

  const updateAvailable = (name: string, latest: string | undefined) => {
    const spec = specs().find((item) => packageName(pluginSpecifier(item)) === name)
    const version = spec ? pluginVersion(pluginSpecifier(spec)) : undefined
    return !!version && isExactVersion(version) && !!latest && version !== latest
  }

  const update = async (name: string, version: string) => {
    if (protocol() !== "v1") return
    const before = specs()
    const next = [...before.filter((item) => packageName(pluginSpecifier(item)) !== name), `${name}@${version}`]
    if (!(await write(next, before))) return
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.plugins.updated.toast.title"),
      description: language.t("settings.plugins.updated.toast.description", { plugin: `${name}@${version}` }),
    })
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
        <div class="settings-v2-plugins-toolbar">
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
          <SegmentedControlV2
            value={store.sort}
            onChange={(value) => {
              if (value === "relevance" || value === "downloads" || value === "updated") setStore("sort", value)
            }}
            aria-label={language.t("settings.plugins.sort")}
          >
            <SegmentedControlItemV2 value="relevance">
              {language.t("settings.plugins.sort.relevance")}
            </SegmentedControlItemV2>
            <SegmentedControlItemV2 value="downloads">
              {language.t("settings.plugins.sort.downloads")}
            </SegmentedControlItemV2>
            <SegmentedControlItemV2 value="updated">
              {language.t("settings.plugins.sort.updated")}
            </SegmentedControlItemV2>
          </SegmentedControlV2>
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
                          <Show when={pluginVersion(value)}>{(version) => <Tag>{version()}</Tag>}</Show>
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
          <h3 class="settings-v2-section-title">{language.t("settings.plugins.install")}</h3>
          <div class="settings-v2-plugins-spec">
            <TextInputV2
              appearance="base"
              value={store.spec}
              onInput={(event) => setStore("spec", event.currentTarget.value)}
              placeholder={language.t("settings.plugins.install.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              aria-label={language.t("settings.plugins.install.placeholder")}
            />
            <ButtonV2
              size="normal"
              variant="neutral"
              icon="plus"
              disabled={store.spec.trim().length === 0}
              onClick={() => void installSpec()}
            >
              {language.t("settings.plugins.install")}
            </ButtonV2>
          </div>
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
                <For each={hits()}>
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
                          <Show when={isInstalled(hit.name)}>
                            <Tag>{language.t("settings.plugins.installed.tag")}</Tag>
                          </Show>
                        </div>
                        <Show when={hit.description}>
                          {(description) => <p class="settings-v2-plugins-description">{description()}</p>}
                        </Show>
                        <Show when={hit.publisher}>
                          {(publisher) => <span class="settings-v2-plugins-meta">{publisher()}</span>}
                        </Show>
                        <Show when={hit.weeklyDownloads}>
                          {(downloads) => (
                            <span class="settings-v2-plugins-meta">
                              {language.t("settings.plugins.weeklyDownloads", {
                                count: formatDownloads(downloads()),
                              })}
                            </span>
                          )}
                        </Show>
                      </div>
                      <Show
                        when={!isInstalled(hit.name)}
                        fallback={
                          <Show when={updateAvailable(hit.name, hit.version) ? hit.version : undefined}>
                            {(version) => (
                              <ButtonV2
                                size="normal"
                                variant="neutral"
                                icon="outline-reset"
                                onClick={() => void update(hit.name, version())}
                              >
                                {language.t("settings.plugins.update")}
                              </ButtonV2>
                            )}
                          </Show>
                        }
                      >
                        <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => void install(hit.name)}>
                          {language.t("settings.plugins.install")}
                        </ButtonV2>
                      </Show>
                    </div>
                  )}
                </For>
                <Show when={hasMore()}>
                  <div class="settings-v2-plugins-more">
                    <ButtonV2 size="normal" variant="ghost-muted" disabled={store.loadingMore} onClick={loadMore}>
                      {language.t("settings.plugins.loadMore")}
                    </ButtonV2>
                  </div>
                </Show>
              </Show>
            </Show>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}


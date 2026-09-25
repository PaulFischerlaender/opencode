import { describe, expect, test } from "bun:test"
import {
  isExactVersion,
  isLocalPlugin,
  packageName,
  pluginHits,
  pluginSearchUrl,
  pluginSpecifier,
  pluginTotal,
  pluginVersion,
  sortPluginHits,
} from "./plugins-model"

describe("plugin marketplace model", () => {
  test("strips npm versions from package names", () => {
    expect(packageName("opencode-poe-auth")).toBe("opencode-poe-auth")
    expect(packageName("opencode-poe-auth@0.0.4")).toBe("opencode-poe-auth")
    expect(packageName("@scope/opencode-plugin")).toBe("@scope/opencode-plugin")
    expect(packageName("@scope/opencode-plugin@1.2.3")).toBe("@scope/opencode-plugin")
    expect(packageName("./plugin.ts")).toBe("./plugin.ts")
    expect(packageName("file:///tmp/plugin.ts")).toBe("file:///tmp/plugin.ts")
  })

  test("reads pinned versions and flags only exact ones as updatable", () => {
    expect(pluginVersion("opencode-poe-auth")).toBeUndefined()
    expect(pluginVersion("opencode-poe-auth@0.0.4")).toBe("0.0.4")
    expect(pluginVersion("@scope/opencode-plugin")).toBeUndefined()
    expect(pluginVersion("@scope/opencode-plugin@1.2.3")).toBe("1.2.3")
    expect(pluginVersion("./plugin.ts")).toBeUndefined()
    expect(pluginVersion("github:user/repo")).toBeUndefined()

    expect(isExactVersion("1.2.3")).toBe(true)
    expect(isExactVersion("0.0.4")).toBe(true)
    expect(isExactVersion("latest")).toBe(false)
    expect(isExactVersion("^1.2.3")).toBe(false)
    expect(isExactVersion("~1.2.3")).toBe(false)
    expect(isExactVersion("1.x")).toBe(false)
  })

  test("detects local plugin specs", () => {
    expect(isLocalPlugin("./plugin.ts")).toBe(true)
    expect(isLocalPlugin("file:///tmp/plugin.ts")).toBe(true)
    expect(isLocalPlugin("C:\\plugins\\thing")).toBe(true)
    expect(isLocalPlugin("/opt/plugins/thing")).toBe(true)
    expect(isLocalPlugin("opencode-poe-auth")).toBe(false)
    expect(isLocalPlugin("@scope/opencode-plugin")).toBe(false)
  })

  test("reads both spec shapes from config", () => {
    expect(pluginSpecifier("opencode-poe-auth")).toBe("opencode-poe-auth")
    expect(pluginSpecifier(["opencode-poe-auth", { token: "x" }])).toBe("opencode-poe-auth")
  })

  test("scopes search to the plugin keyword", () => {
    const url = pluginSearchUrl("auth")
    expect(url.origin + url.pathname).toBe("https://registry.npmjs.org/-/v1/search")
    expect(url.searchParams.get("text")).toBe("auth opencode-plugin")
    expect(pluginSearchUrl("  ").searchParams.get("text")).toBe("keywords:opencode-plugin")
    expect(url.searchParams.get("size")).toBe("50")
  })

  test("totals and sorts plugin hits", () => {
    expect(pluginTotal({ total: 2050 })).toBe(2050)
    expect(pluginTotal({})).toBeUndefined()
    expect(pluginTotal(undefined)).toBeUndefined()

    const hits = [
      { name: "a", weeklyDownloads: 10, updated: "2024-01-01T00:00:00.000Z" },
      { name: "b", weeklyDownloads: 30, updated: "2025-01-01T00:00:00.000Z" },
      { name: "c", weeklyDownloads: 20, updated: "2023-01-01T00:00:00.000Z" },
    ]
    expect(sortPluginHits(hits, "relevance")).toBe(hits)
    expect(sortPluginHits(hits, "downloads").map((hit) => hit.name)).toEqual(["b", "c", "a"])
    expect(sortPluginHits(hits, "updated").map((hit) => hit.name)).toEqual(["b", "a", "c"])
  })

  test("parses registry hits and rejects malformed or unrelated bodies", () => {
    const body = {
      total: 2050,
      objects: [
        {
          downloads: { weekly: 167699 },
          package: {
            name: "opencode-poe-auth",
            version: "0.0.4",
            description: "Poe OAuth authentication plugin for OpenCode",
            publisher: { username: "kamilio" },
            date: "2026-05-08T14:15:21.383Z",
          },
        },
        {
          package: {
            name: "@dietrichgebert/ponytail",
            version: "1.0.0",
            description: "Lazy senior dev mode for AI agents.",
            keywords: ["opencode-plugin"],
          },
        },
        { package: { name: "wakatime-sync", description: "WakaTime plugin for OpenCode and Claude Code" } },
        { package: { name: "@dingyi222666/dsh-wakatime", description: "WakaTime plugin for DeepSeek Harness" } },
        { package: { version: "1.0.0" } },
        { nonsense: true },
      ],
    }
    expect(pluginHits(body)).toEqual([
      {
        name: "opencode-poe-auth",
        version: "0.0.4",
        description: "Poe OAuth authentication plugin for OpenCode",
        publisher: "kamilio",
        weeklyDownloads: 167699,
        updated: "2026-05-08T14:15:21.383Z",
      },
      {
        name: "@dietrichgebert/ponytail",
        version: "1.0.0",
        description: "Lazy senior dev mode for AI agents.",
        publisher: undefined,
        weeklyDownloads: undefined,
        updated: undefined,
      },
      {
        name: "wakatime-sync",
        version: undefined,
        description: "WakaTime plugin for OpenCode and Claude Code",
        publisher: undefined,
        weeklyDownloads: undefined,
        updated: undefined,
      },
    ])
    expect(pluginHits({})).toBeUndefined()
    expect(pluginHits(undefined)).toBeUndefined()
    expect(pluginHits({ objects: "nope" })).toBeUndefined()
  })
})

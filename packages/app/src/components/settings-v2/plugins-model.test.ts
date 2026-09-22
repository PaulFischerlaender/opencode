import { describe, expect, test } from "bun:test"
import { isLocalPlugin, packageName, pluginHits, pluginSearchUrl, pluginSpecifier } from "./plugins-model"

describe("plugin marketplace model", () => {
  test("strips npm versions from package names", () => {
    expect(packageName("opencode-poe-auth")).toBe("opencode-poe-auth")
    expect(packageName("opencode-poe-auth@0.0.4")).toBe("opencode-poe-auth")
    expect(packageName("@scope/opencode-plugin")).toBe("@scope/opencode-plugin")
    expect(packageName("@scope/opencode-plugin@1.2.3")).toBe("@scope/opencode-plugin")
    expect(packageName("./plugin.ts")).toBe("./plugin.ts")
    expect(packageName("file:///tmp/plugin.ts")).toBe("file:///tmp/plugin.ts")
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

  test("parses registry hits and rejects malformed or unrelated bodies", () => {
    const body = {
      objects: [
        {
          package: {
            name: "opencode-poe-auth",
            version: "0.0.4",
            description: "Poe OAuth authentication plugin for OpenCode",
            publisher: { username: "kamilio" },
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
      },
      {
        name: "@dietrichgebert/ponytail",
        version: "1.0.0",
        description: "Lazy senior dev mode for AI agents.",
        publisher: undefined,
      },
      {
        name: "wakatime-sync",
        version: undefined,
        description: "WakaTime plugin for OpenCode and Claude Code",
        publisher: undefined,
      },
    ])
    expect(pluginHits({})).toBeUndefined()
    expect(pluginHits(undefined)).toBeUndefined()
    expect(pluginHits({ objects: "nope" })).toBeUndefined()
  })
})

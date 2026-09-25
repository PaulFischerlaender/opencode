import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import { Effect, Option, Queue } from "effect"
import * as TestClock from "effect/testing/TestClock"
import path from "path"
import { pathToFileURL } from "url"
import type { PluginUiInput } from "@opencode-ai/plugin"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin as PluginService } from "../../src/plugin/index"
import { PluginUi } from "../../src/plugin/ui"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { InstanceStore } from "../../src/project/instance-store"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([PluginUi.node, EventV2Bridge.node])))

const itPlugin = testEffect(
  AppNodeBuilder.build(LayerNode.group([PluginService.node, PluginUi.node, EventV2Bridge.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

// Typed with the published plugin authoring contract so schema drift fails here.
const widget: PluginUiInput = {
  slot: "sidebar.footer",
  title: "Usage",
  rows: [
    { type: "text", text: "go usage 12.4k tok · $0.42", tone: "muted" },
    { type: "progress", label: "5h", percent: 62, detail: "resets in 3h 12m" },
    { type: "link", label: "Dashboard", href: "https://example.com/usage" },
  ],
}

const publish = (plugin: string, input: PluginUiInput) =>
  Effect.gen(function* () {
    const ui = yield* PluginUi.Service
    return yield* ui.publish({ plugin, slot: input.slot, widget: { title: input.title, rows: input.rows } })
  })

const pluginSource = [
  "export default {",
  '  id: "ui-smoke",',
  "  server: async ({ ui }) => {",
  '    ui.publish({ slot: "sidebar.footer", title: "Smoke", rows: [{ type: "text", text: "hi" }] })',
  "    return {}",
  "  },",
  "}",
].join("\n")

const failingPluginSource = [
  "export default {",
  '  id: "boom",',
  "  server: async () => {",
  "    throw new Error('boom')",
  "  },",
  "}",
].join("\n")

function withFilePlugin<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const file = path.join(test.directory, "plugin.ts")
    yield* Effect.all(
      [
        Effect.promise(() => Bun.write(file, source)),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [pathToFileURL(file).href] }, null, 2),
          ),
        ),
      ],
      { discard: true, concurrency: 2 },
    )
    return yield* self
  })
}

describe("plugin ui", () => {
  it.effect("keeps one widget per plugin and slot", () =>
    Effect.gen(function* () {
      const ui = yield* PluginUi.Service
      yield* publish("pkg-a", widget)
      yield* publish("pkg-b", { ...widget, title: "Other" })
      expect((yield* ui.list()).map((entry) => entry.plugin).join(",")).toBe("pkg-a,pkg-b")

      yield* publish("pkg-a", { ...widget, rows: [{ type: "text", text: "updated" }] })
      expect((yield* ui.list()).length).toBe(2)
      expect((yield* ui.list())[0].widget.rows).toEqual([{ type: "text", text: "updated" }])

      yield* ui.clear({ plugin: "pkg-a", slot: "sidebar.footer" })
      // Cleared widgets stay until the grace window expires so a rebuild can
      // republish them without a flicker.
      expect((yield* ui.list()).length).toBe(2)
      yield* TestClock.adjust("3 seconds")
      expect((yield* ui.list()).map((entry) => entry.plugin).join(",")).toBe("pkg-b")

      yield* ui.clear({ plugin: "pkg-b" })
      yield* TestClock.adjust("3 seconds")
      expect(yield* ui.list()).toEqual([])
    }),
  )

  it.effect("keeps a widget that is republished during the grace window", () =>
    Effect.gen(function* () {
      const ui = yield* PluginUi.Service
      const events = yield* EventV2Bridge.Service
      const cleared = yield* Queue.unbounded<unknown>()
      const off = yield* events.listen((event) => {
        if (event.type === Plugin.Event.UiCleared.type) Queue.offerUnsafe(cleared, event.data)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => off)

      yield* publish("pkg-a", widget)
      yield* ui.clear({ plugin: "pkg-a" })
      yield* publish("pkg-a", widget)
      yield* TestClock.adjust("3 seconds")

      expect((yield* ui.list()).map((entry) => entry.plugin).join(",")).toBe("pkg-a")
      expect(yield* Queue.poll(cleared)).toEqual(Option.none())
    }),
  )

  it.effect("publishes update and clear events", () =>
    Effect.gen(function* () {
      const events = yield* EventV2Bridge.Service
      const seen = yield* Queue.unbounded<{ type: string; data: unknown }>()
      const off = yield* events.listen((event) => {
        if (event.type !== Plugin.Event.UiUpdated.type && event.type !== Plugin.Event.UiCleared.type) return Effect.void
        Queue.offerUnsafe(seen, { type: event.type, data: event.data })
        return Effect.void
      })
      yield* Effect.addFinalizer(() => off)

      yield* publish("pkg-a", widget)
      expect(yield* Queue.take(seen)).toEqual({
        type: "plugin.ui.updated",
        data: { slot: "sidebar.footer", plugin: "pkg-a", widget: { title: "Usage", rows: widget.rows } },
      })

      yield* (yield* PluginUi.Service).clear({ plugin: "pkg-a" })
      yield* TestClock.adjust("3 seconds")
      expect(yield* Queue.take(seen)).toEqual({
        type: "plugin.ui.cleared",
        data: { slot: "sidebar.footer", plugin: "pkg-a" },
      })
    }),
  )

  it.effect("reports and clears plugin load errors", () =>
    Effect.gen(function* () {
      const ui = yield* PluginUi.Service
      const events = yield* EventV2Bridge.Service
      const seen = yield* Queue.unbounded<{ type: string; data: unknown }>()
      const off = yield* events.listen((event) => {
        if (event.type !== Plugin.Event.UiError.type) return Effect.void
        Queue.offerUnsafe(seen, { type: event.type, data: event.data })
        return Effect.void
      })
      yield* Effect.addFinalizer(() => off)

      yield* ui.report({ plugin: "pkg-a", message: "boom" })
      expect((yield* ui.errors()).map((entry) => `${entry.plugin}:${entry.message}`).join(",")).toBe("pkg-a:boom")
      expect(yield* Queue.take(seen)).toEqual({
        type: "plugin.ui.error",
        data: { plugin: "pkg-a", message: "boom" },
      })

      yield* ui.clearError({ plugin: "pkg-a" })
      expect(yield* ui.errors()).toEqual([])
      expect(yield* Queue.take(seen)).toEqual({ type: "plugin.ui.error", data: { plugin: "pkg-a" } })
    }),
  )

  it.effect("drops errors for plugins that are no longer configured", () =>
    Effect.gen(function* () {
      const ui = yield* PluginUi.Service
      yield* ui.report({ plugin: "pkg-a", message: "a" })
      yield* ui.report({ plugin: "pkg-b", message: "b" })
      yield* ui.retainErrors(["pkg-a"])
      expect((yield* ui.errors()).map((entry) => entry.plugin).join(",")).toBe("pkg-a")
    }),
  )

  itPlugin.instance("collects widgets published by a file plugin", () =>
    withFilePlugin(
      pluginSource,
      Effect.gen(function* () {
        const plugin = yield* PluginService.Service
        yield* plugin.init()
        const ui = yield* PluginUi.Service
        const entry = yield* pollWithTimeout(
          ui.list().pipe(Effect.map((entries) => entries.find((item) => item.plugin === "ui-smoke"))),
          "file plugin never published a widget",
        )
        expect(entry.widget).toEqual({ title: "Smoke", rows: [{ type: "text", text: "hi" }] })

        const events = yield* EventV2Bridge.Service
        const cleared = yield* Queue.unbounded<unknown>()
        const off = yield* events.listen((event) => {
          if (event.type === Plugin.Event.UiCleared.type) Queue.offerUnsafe(cleared, event.data)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => off)

        // Disposing the instance is what a config change does, and a plugin that
        // stays gone must have its widget dropped and clients told about it.
        const store = yield* InstanceStore.Service
        yield* store.disposeAll()
        yield* pollWithTimeout(
          ui.list().pipe(Effect.map((entries) => (entries.length === 0 ? (true as const) : undefined))),
          "cleared widget was never dropped",
        )
        expect(yield* Queue.take(cleared)).toEqual({ slot: "sidebar.footer", plugin: "ui-smoke" })
      }),
    ),
  )

  itPlugin.instance("reports an error when a file plugin fails to load", () =>
    withFilePlugin(
      failingPluginSource,
      Effect.gen(function* () {
        const plugin = yield* PluginService.Service
        yield* plugin.init()
        const ui = yield* PluginUi.Service
        const entry = yield* pollWithTimeout(
          ui.errors().pipe(Effect.map((entries) => entries.find((item) => item.message.includes("boom")))),
          "failed plugin never reported an error",
        )
        expect(entry.message).toBe("boom")
      }),
    ),
  )
})

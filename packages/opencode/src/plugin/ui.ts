import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Plugin } from "@opencode-ai/schema/plugin"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Context, Clock, Duration, Effect, Layer, Schedule } from "effect"

export interface Entry {
  readonly slot: string
  readonly plugin: Plugin.ID
  readonly widget: Plugin.UiWidget
}

export interface ErrorEntry {
  readonly plugin: Plugin.ID
  readonly message: string
}

export interface Interface {
  readonly publish: (input: { plugin: string; slot: string; widget: Plugin.UiWidget }) => Effect.Effect<void>
  readonly clear: (input: { plugin: string; slot?: string }) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Entry[]>
  readonly report: (input: { plugin: string; message: string }) => Effect.Effect<void>
  readonly clearError: (input: { plugin: string }) => Effect.Effect<void>
  readonly retainErrors: (plugins: readonly string[]) => Effect.Effect<void>
  readonly errors: () => Effect.Effect<ErrorEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginUi") {}

// Any config change disposes every instance, so a plugin that is still
// installed republishes moments later. Hold cleared widgets for a grace window
// and drop them only if nothing republishes, which avoids a flicker on rebuild.
const GRACE_MS = 1_500
const SWEEP = Duration.millis(250)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const widgets = new Map<string, Entry>()
    const pending = new Map<string, { entry: Entry; expires: number }>()
    const errors = new Map<string, ErrorEntry>()

    const emitError = (plugin: string, message?: string) =>
      events.publish(
        Plugin.Event.UiError,
        message === undefined
          ? { plugin: Plugin.ID.make(plugin) }
          : { plugin: Plugin.ID.make(plugin), message },
      )

    yield* Clock.currentTimeMillis.pipe(
      Effect.tap((now) =>
        Effect.forEach(
          [...pending],
          ([key, item]) => {
            if (item.expires > now) return Effect.void
            pending.delete(key)
            widgets.delete(key)
            return events.publish(Plugin.Event.UiCleared, { slot: item.entry.slot, plugin: item.entry.plugin })
          },
          { discard: true },
        ),
      ),
      Effect.catchCause((cause) => Effect.logError("plugin ui sweep failed", { cause })),
      Effect.repeat(Schedule.spaced(SWEEP)),
      Effect.forkScoped,
    )

    const publish = Effect.fn("PluginUi.publish")(function* (input: {
      plugin: string
      slot: string
      widget: Plugin.UiWidget
    }) {
      const plugin = Plugin.ID.make(input.plugin)
      const key = `${input.plugin}\u0000${input.slot}`
      pending.delete(key)
      widgets.set(key, { slot: input.slot, plugin, widget: input.widget })
      yield* events.publish(Plugin.Event.UiUpdated, { slot: input.slot, plugin, widget: input.widget })
    })

    const clear = Effect.fn("PluginUi.clear")(function* (input: { plugin: string; slot?: string }) {
      const plugin = Plugin.ID.make(input.plugin)
      const expires = (yield* Clock.currentTimeMillis) + GRACE_MS
      for (const [key, entry] of widgets) {
        if (entry.plugin !== plugin) continue
        if (input.slot !== undefined && entry.slot !== input.slot) continue
        pending.set(key, { entry, expires })
      }
    })

    const list = Effect.fn("PluginUi.list")(function* () {
      return [...widgets.values()]
    })

    const report = Effect.fn("PluginUi.report")(function* (input: { plugin: string; message: string }) {
      errors.set(input.plugin, { plugin: Plugin.ID.make(input.plugin), message: input.message })
      yield* emitError(input.plugin, input.message)
    })

    const clearError = Effect.fn("PluginUi.clearError")(function* (input: { plugin: string }) {
      if (!errors.delete(input.plugin)) return
      yield* emitError(input.plugin)
    })

    // Drop errors for plugins that are no longer configured so an uninstall does
    // not leave a permanent failure in the drawer.
    const retainErrors = Effect.fn("PluginUi.retainErrors")(function* (plugins: readonly string[]) {
      const keep = new Set(plugins)
      for (const plugin of errors.keys()) {
        if (keep.has(plugin)) continue
        errors.delete(plugin)
        yield* emitError(plugin)
      }
    })

    const listErrors = Effect.fn("PluginUi.errors")(function* () {
      return [...errors.values()]
    })

    return Service.of({ publish, clear, list, report, clearError, retainErrors, errors: listErrors })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [EventV2Bridge.node] })

export * as PluginUi from "./ui"

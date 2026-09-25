import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option, Queue, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { PluginUi } from "../../src/plugin/ui"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    // Raw HttpApi routes expose an opaque handler context at the request boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(Layer.mock(PluginUi.Service)({ list: () => Effect.succeed(widgets), errors: () => Effect.succeed(errors) })),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(
    Layer.mock(Installation.Service)({
      method: () => Effect.succeed("npm"),
      latest: () => Effect.succeed("9.9.9"),
      upgrade: () => Effect.void,
    }),
  ),
  Layer.provide(ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode" })),
)
const widgets = [
  {
    slot: "sidebar.footer",
    plugin: Plugin.ID.make("pkg-a"),
    widget: { title: "Usage", rows: [{ type: "text" as const, text: "go usage" }] },
  },
]
const errors = [{ plugin: Plugin.ID.make("pkg-b"), message: "Failed to load plugin pkg-b: boom" }]

const readEvent = (reader: Queue.Dequeue<Uint8Array>, state: { buffer: string }) =>
  Effect.gen(function* () {
    while (true) {
      const index = state.buffer.indexOf("\n\n")
      if (index >= 0) {
        const frame = state.buffer.slice(0, index)
        state.buffer = state.buffer.slice(index + 2)
        const line = frame.split("\n").find((item) => item.startsWith("data: "))
        if (!line) continue
        return JSON.parse(line.slice("data: ".length)) as {
          payload: { type: string; properties: Record<string, unknown> }
        }
      }
      const value = yield* Queue.take(reader).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new Error("timed out waiting for event")),
        }),
      )
      state.buffer += new TextDecoder().decode(value)
    }
  })

const it = testEffect(apiLayer)

describe("global HttpApi", () => {
  it.live("upgrades to the requested version", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.bodyJsonUnsafe({ target: "9.9.9" }),
        HttpClient.execute,
      )

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ success: true, version: "9.9.9" })
    }),
  )

  it.live("rejects invalid upgrade payloads", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.bodyJsonUnsafe({ target: 1 }),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
    }),
  )

  it.live("rejects invalid upgrade target versions", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.bodyJsonUnsafe({ target: "latest" }),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
    }),
  )

  it.live("rejects unsupported upgrade content types", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.setBody(HttpBody.text('{"target":"1.0.0"}', "text/plain")),
        HttpClient.execute,
      )

      expect(response.status).toBe(415)
    }),
  )

  it.live("replays published plugin widgets when a client connects", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.get(GlobalPaths.event).pipe(HttpClient.execute)
      const reader = yield* Queue.unbounded<Uint8Array>()
      yield* response.stream.pipe(
        Stream.runForEach((value) => Queue.offer(reader, value)),
        Effect.forkScoped,
      )

      const state = { buffer: "" }
      expect(yield* readEvent(reader, state)).toMatchObject({ payload: { type: "server.connected" } })
      expect(yield* readEvent(reader, state)).toMatchObject({
        payload: {
          type: "plugin.ui.updated",
          properties: { slot: "sidebar.footer", plugin: "pkg-a", widget: widgets[0].widget },
        },
      })
      expect(yield* readEvent(reader, state)).toMatchObject({
        payload: {
          type: "plugin.ui.error",
          properties: { plugin: "pkg-b", message: "Failed to load plugin pkg-b: boom" },
        },
      })
    }),
  )
})

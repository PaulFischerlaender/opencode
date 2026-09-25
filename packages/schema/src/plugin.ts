export * as Plugin from "./plugin"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { NonNegativeInt, optional } from "./schema"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

const Added = define({
  type: "plugin.added",
  schema: { id: ID },
})

export const UiTone = Schema.Literals(["base", "muted", "success", "warning", "danger"]).annotate({
  identifier: "Plugin.UiTone",
})
export type UiTone = typeof UiTone.Type

const UiTextRow = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  tone: optional(UiTone),
})

const UiProgressRow = Schema.Struct({
  type: Schema.Literal("progress"),
  label: Schema.String,
  percent: NonNegativeInt,
  detail: optional(Schema.String),
})

const UiLinkRow = Schema.Struct({
  type: Schema.Literal("link"),
  label: Schema.String,
  href: Schema.String,
})

export const UiRow = Schema.Union([UiTextRow, UiProgressRow, UiLinkRow])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Plugin.UiRow" })
export type UiRow = typeof UiRow.Type

export interface UiWidget extends Schema.Schema.Type<typeof UiWidget> {}
export const UiWidget = Schema.Struct({
  title: optional(Schema.String),
  rows: Schema.Array(UiRow),
}).annotate({ identifier: "Plugin.UiWidget" })

const UiUpdated = define({
  type: "plugin.ui.updated",
  schema: { slot: Schema.String, plugin: ID, widget: UiWidget },
})

const UiCleared = define({
  type: "plugin.ui.cleared",
  schema: { slot: Schema.String, plugin: ID },
})

// A load failure for one plugin. An omitted message clears the error, which is
// how a plugin that starts loading again after a config change is forgotten.
const UiError = define({
  type: "plugin.ui.error",
  schema: { plugin: ID, message: optional(Schema.String) },
})

export const Event = {
  Added,
  UiUpdated,
  UiCleared,
  UiError,
  Definitions: inventory(Added, UiUpdated, UiCleared, UiError),
}

import { describe, expect, test } from "bun:test"
import { isSafeHref } from "./plugin-slot"

describe("plugin link rows", () => {
  test("only http(s) hrefs are navigable", () => {
    expect(isSafeHref("https://example.com/usage")).toBe(true)
    expect(isSafeHref("http://example.com")).toBe(true)
    expect(isSafeHref("HTTPS://example.com")).toBe(true)
    expect(isSafeHref("javascript:alert(1)")).toBe(false)
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false)
    expect(isSafeHref("file:///etc/passwd")).toBe(false)
    expect(isSafeHref("//example.com")).toBe(false)
  })
})

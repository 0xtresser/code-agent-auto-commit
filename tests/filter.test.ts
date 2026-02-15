import test from "node:test"
import assert from "node:assert/strict"
import { shouldIncludePath } from "../src/core/filter"

test("include and exclude patterns are applied", () => {
  assert.equal(shouldIncludePath("src/app.ts", ["src/**"], []), true)
  assert.equal(shouldIncludePath("README.md", ["src/**"], []), false)
  assert.equal(shouldIncludePath(".env", [], [".env", ".env.*"]), false)
  assert.equal(shouldIncludePath("src/main.ts", [], ["*.md"]), true)
})

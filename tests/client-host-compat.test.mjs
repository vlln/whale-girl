import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('client bundle loads without removed settings services or platform modules', () => {
  let plugin
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) {
      plugin = factory((id) => { throw new Error(`Unexpected platform import: ${id}`) })
    } } },
  })
  assert.equal(plugin.name, 'whale-girl')
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(plugin.inject.length, 0)
})

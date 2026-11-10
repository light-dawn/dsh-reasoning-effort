import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const temporary = resolve('.client-build/configuration-tests')
await mkdir(temporary, { recursive: true })
await build({ entryPoints: ['src/compat/controller.ts', 'src/compat/plan.ts'], outdir: temporary, bundle: true, platform: 'node', format: 'esm' })
const { CompatibilityController, COMPAT_NS } = await import(pathToFileURL(resolve(temporary, 'controller.js')))
const { plans, EFFORTS, COMPAT, endpointOf } = await import(pathToFileURL(resolve(temporary, 'plan.js')))
const target = { provider: 'custom', model: 'model-a' }
const rule = (value = target, endpoint = 'https://gateway.example/v1') => ({ ...value, endpoint, preset: 'deepseek-four-levels' })
function section(models = [{ id: 'model-a' }, { id: 'model-b' }], route = {}) {
  return { providers: { custom: { api: 'openai-completions', baseURL: 'https://gateway.example/v1/', apiKeyEnv: 'FAKE_KEY', headers: { 'x-test': 'preserved' }, models, ...route } } }
}
function settings(source = section(), rules = []) {
  const rows = [
    { ns: 'llm-pi-ai', revision: 0, value: structuredClone(source), schema: { reasoningEfforts: {}, ...COMPAT } },
    { ns: COMPAT_NS, revision: 0, value: { autoCompat: true, compatRules: rules, compatJournal: [] } },
  ]
  const calls = []
  return { rows, calls, writable: true, describe: () => structuredClone(rows.map(row => ({ ...row, raw: row.value }))),
    async mutate(ns, ops, revision) {
      await this.beforeWrite?.(ns, ops)
      const row = rows.find(item => item.ns === ns)
      if (row.revision !== revision) throw new Error('revision conflict')
      const next = structuredClone(row.value)
      for (const op of ops) {
        let parent = next
        for (const key of op.path.slice(0, -1)) parent = parent[key] ??= {}
        if (op.op === 'unset') delete parent[op.path.at(-1)]
        else Object.defineProperty(parent, op.path.at(-1), { value: structuredClone(op.value), configurable: true, enumerable: true, writable: true })
      }
      row.value = next
      row.revision++
      calls.push({ ns, ops })
      this.onWrite?.(ns)
    },
  }
}

test('install and status queries never select endpoints or write model configuration', async () => {
  const api = settings()
  const controller = new CompatibilityController(api)
  const status = await controller.run('status')
  assert.equal(status.models[0].status, 'available')
  await controller.run()
  assert.equal(api.calls.length, 0)
  assert.deepEqual(api.rows[0].value, section())
  assert.deepEqual(plans(section(), []), [])
})

test('one explicit click fills only the addressed model at any configured endpoint', async () => {
  for (const baseURL of ['https://gateway.example/v1', 'https://another.example/api/', 'http://localhost:8181/custom']) {
    const source = section(undefined, { baseURL })
    const api = settings(source)
    const controller = new CompatibilityController(api)
    const status = await controller.run('enable-model', target)
    assert.equal(status.models[0].status, 'applied')
    assert.equal(status.owned, 4)
    assert.deepEqual(api.rows[0].value.providers.custom.models, [{ id: 'model-a', reasoningEfforts: EFFORTS, compat: COMPAT }, { id: 'model-b' }])
    assert.deepEqual(api.rows[0].value.providers.custom.headers, source.providers.custom.headers)
    assert.equal(api.rows[1].value.compatRules[0].endpoint, endpointOf(baseURL))
    await controller.run('restore-model', target)
    assert.deepEqual(api.rows[0].value, source)
  }
})

test('saved choices are idempotent across controller restarts', async () => {
  const api = settings()
  await new CompatibilityController(api).run('enable-model', target)
  const count = api.calls.length
  await new CompatibilityController(api).run()
  await new CompatibilityController(api).run('status')
  assert.equal(api.calls.length, count)
})

test('a saved choice is bound to its exact provider, normalized address and model', async () => {
  assert.equal(plans(section(), [rule()])[0].changes.length, 4)
  for (const baseURL of ['https://gateway.example.evil/v1', 'https://another.example/v1', 'https://gateway.example/v2']) {
    const plan = plans(section(undefined, { baseURL }), [rule()])[0]
    assert.equal(plan.status, 'unsupported')
    assert.equal(plan.changes.length, 0)
  }
  assert.equal(plans(section(undefined, { api: 'openai-responses' }), [rule()])[0].status, 'unsupported')
  assert.equal(plans(section(), [rule({ provider: 'missing', model: 'model-a' })])[0].status, 'unsupported')
  for (const endpoint of ['https://user:secret@gateway.example/v1', 'https://gateway.example/v1?key=secret', 'https://gateway.example/v1#x', 'file:///config']) assert.equal(endpointOf(endpoint), undefined)
})

test('explicit reasoning disable, custom levels and inherited compatibility are preserved', async () => {
  const source = section([{ id: 'model-a', reasoningEfforts: false }])
  const api = settings(source)
  assert.equal((await new CompatibilityController(api).run('enable-model', target)).models[0].status, 'disabled')
  assert.deepEqual(api.rows[0].value, source)
  const conflicting = settings(section([{ id: 'model-a', reasoningEfforts: { high: 'custom' } }]))
  assert.equal((await new CompatibilityController(conflicting).run('enable-model', target)).models[0].status, 'conflict')
  assert.deepEqual(conflicting.rows[0].value.providers.custom.models[0].reasoningEfforts, { high: 'custom' })
  const inherited = settings(section([{ id: 'model-a', reasoningEfforts: EFFORTS }], { compat: COMPAT }))
  assert.equal((await new CompatibilityController(inherited).run('enable-model', target)).owned, 0)
  assert.equal(inherited.calls.some(call => call.ns === 'llm-pi-ai'), false)
})

test('conflict repair requires an explicit managed target and retains the original for restore', async () => {
  const source = section([{ id: 'model-a', reasoningEfforts: { high: 'custom' } }], { compat: { thinkingFormat: 'openai', supportsDeveloperRole: true } })
  const api = settings(source)
  const controller = new CompatibilityController(api)
  await controller.run('repair', target)
  assert.equal(api.calls.length, 0)
  await controller.run('enable-model', target)
  assert.equal((await controller.run('repair', target)).models[0].status, 'applied')
  await controller.run('restore-model', target)
  assert.deepEqual(api.rows[0].value, source)
})

test('model restoration preserves subsequent user edits and follows ids after reorder', async () => {
  const api = settings()
  const controller = new CompatibilityController(api)
  await controller.run('enable-model', target)
  await controller.run('enable-model', { provider: 'custom', model: 'model-b' })
  const models = api.rows[0].value.providers.custom.models
  models[0].compat.supportsDeveloperRole = true
  models[0].name = 'User rename'
  models.reverse()
  api.rows[0].revision++
  await controller.run('restore-model', target)
  assert.deepEqual(api.rows[0].value.providers.custom.models[1], { id: 'model-a', name: 'User rename', compat: { supportsDeveloperRole: true } })
  assert.deepEqual(api.rows[0].value.providers.custom.models[0].reasoningEfforts, EFFORTS)
  const count = api.calls.length
  await new CompatibilityController(api).run()
  assert.equal(api.calls.length, count)
})

test('null and empty compat originals survive repair and scoped restore', async () => {
  for (const compat of [null, {}]) {
    const source = section([{ id: 'model-a', compat }])
    const api = settings(source)
    const controller = new CompatibilityController(api)
    await controller.run('enable-model', target)
    if (compat === null) await controller.run('repair', target)
    await new CompatibilityController(api).run('restore-model', target)
    assert.deepEqual(api.rows[0].value, source)
  }
})

test('read-only, missing capabilities and duplicate model ids refuse writes', async () => {
  for (const configure of [api => { api.writable = false }, api => { delete api.mutate }, api => { delete api.rows[0].schema }, api => { api.rows.pop() }]) {
    const api = settings()
    configure(api)
    assert.equal((await new CompatibilityController(api).run('enable-model', target)).status, 'unsupported')
    assert.equal(api.calls.length, 0)
  }
  const duplicate = settings(section([{ id: 'model-a' }, { id: 'model-a' }]))
  assert.equal((await new CompatibilityController(duplicate).run('enable-model', target)).status, 'failed')
  assert.equal(duplicate.calls.length, 0)
})

test('concurrent configuration changes are preserved and the next scan can retry', async () => {
  const api = settings()
  let changed = false
  api.beforeWrite = ns => {
    if (ns !== 'llm-pi-ai' || changed) return
    changed = true
    api.rows[0].value.providers.custom.displayName = 'Concurrent edit'
    api.rows[0].revision++
  }
  const controller = new CompatibilityController(api)
  assert.equal((await controller.run('enable-model', target)).status, 'failed')
  assert.equal(api.rows[0].value.providers.custom.models[0].compat, undefined)
  assert.equal((await controller.run()).status, 'ready')
  assert.equal(api.rows[0].value.providers.custom.displayName, 'Concurrent edit')
})

test('a simultaneous user opt-out is never overwritten by the recovery journal', async () => {
  const api = settings()
  api.beforeWrite = ns => {
    if (ns !== COMPAT_NS) return
    api.rows[1].value.autoCompat = false
    api.rows[1].revision++
    delete api.beforeWrite
  }
  assert.equal((await new CompatibilityController(api).run('enable-model', target)).status, 'failed')
  assert.equal(api.rows[1].value.autoCompat, false)
  assert.deepEqual(api.rows[0].value, section())
})

test('persistence failures retain recovery information and never claim successful writes', async () => {
  const api = settings()
  api.beforeWrite = ns => { if (ns === 'llm-pi-ai') throw new Error('private provider headers') }
  const controller = new CompatibilityController(api)
  const result = await controller.run('enable-model', target)
  assert.equal(result.status, 'failed')
  assert.equal(result.owned, 4)
  assert.equal(JSON.stringify(result).includes('private provider'), false)
  assert.deepEqual(api.rows[0].value, section())
  delete api.beforeWrite
  await controller.run('restore-model', target)
  assert.deepEqual(api.rows[0].value, section())
})

test('native write notifications settle without a self-triggered write loop', async () => {
  const api = settings()
  const controller = new CompatibilityController(api)
  const notifications = []
  api.onWrite = () => notifications.push(controller.run())
  await controller.run('enable-model', target)
  await Promise.all(notifications)
  assert.equal(api.calls.length, 3)
})

test('schema defaults and computed configuration never get copied into raw models', async () => {
  const api = settings()
  const describe = api.describe
  api.describe = () => describe().map(row => row.ns === 'llm-pi-ai' ? ({ ...row, value: section([{ id: 'model-a', input: [], compat: { chatTemplateArgs: {} } }]) }) : row)
  const controller = new CompatibilityController(api)
  await controller.run('enable-model', target)
  assert.equal(Object.hasOwn(api.rows[0].value.providers.custom.models[0], 'input'), false)
  await controller.run('restore-model', target)
  assert.deepEqual(api.rows[0].value, section())
  const computed = settings(section([{ id: 'model-a', compat: { __jsExpr: 'computed' } }]))
  assert.equal((await new CompatibilityController(computed).run('enable-model', target)).models[0].status, 'unsupported')
  assert.equal(computed.calls.some(call => call.ns === 'llm-pi-ai'), false)
})

test('changing the endpoint never causes an old opt-in or restore to follow it', async () => {
  const api = settings()
  const controller = new CompatibilityController(api)
  await controller.run('enable-model', target)
  api.rows[0].value.providers.custom.baseURL = 'https://new-service.example/v1'
  const changed = structuredClone(api.rows[0].value)
  assert.equal((await controller.run()).models[0].status, 'unsupported')
  await controller.run('restore-model', target)
  assert.deepEqual(api.rows[0].value, changed)
})

test('production compatibility code contains no fixed endpoint URLs', async () => {
  for (const file of ['src/compat/plan.ts', 'src/compat/controller.ts', 'src/client/provider-settings.tsx', 'src/client/locales.ts']) {
    const source = await readFile(file, 'utf8')
    assert.equal(/https?:\/\/[a-z0-9]/iu.test(source), false, file)
  }
})

test('legacy records without an endpoint are preserved without being applied to a new opt-in', async () => {
  const api = settings()
  const legacy = { provider: 'old-provider', model: 'old-model', field: 'reasoningEfforts', before: { present: false }, after: EFFORTS }
  api.rows[1].value.compatJournal = [legacy]
  const controller = new CompatibilityController(api)
  await controller.run('enable-model', target)
  assert.deepEqual(api.rows[1].value.compatJournal.at(-1), legacy)
  await controller.run('restore-model', target)
  assert.deepEqual(api.rows[1].value.compatJournal, [legacy])
  assert.deepEqual(api.rows[0].value, section())
})

test('write endpoints keep authentication, transport envelopes and read-only status semantics', async () => {
  const outfile = resolve(temporary, 'host.mjs')
  await build({ entryPoints: ['src/index.ts'], outfile, bundle: true, platform: 'node', format: 'esm' })
  const host = await import(pathToFileURL(outfile))
  const api = settings()
  let route, rejection
  const services = { settings: api, llm: {}, configEditor: { entries: () => api.rows.map(row => ({ options: { id: row.ns, config: row.value } })) },
    connection: { requestRejection: () => rejection }, webServer: { register: value => { route = value; return () => {} } } }
  const ctx = { get: name => services[name], inject: (_, callback) => callback(ctx), effect: callback => callback() }
  host.apply(ctx)
  async function request(endpoint, envelope = {}) {
    const events = {}
    let code, body
    const pending = route.handler({ method: 'POST', url: `/light-dawn-reasoning-effort/${endpoint}`, headers: { 'content-type': 'application/json' },
      on: (event, callback) => { events[event] = callback } }, { writeHead: value => { code = value }, end: value => { body = value } })
    if (events.data) { events.data(Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'test', method: endpoint, ...envelope }))); events.end() }
    await pending
    return { code, body }
  }
  for (rejection of [401, 403]) {
    assert.equal((await request('compat-enable-model', { payload: target })).code, rejection)
    assert.equal(api.calls.length, 0)
  }
  rejection = undefined
  assert.equal((await request('compat-status', { method: 'compat-enable-model', payload: target })).code, 400)
  assert.equal(api.calls.length, 0)
  const status = await request('compat-status')
  assert.equal(status.code, 200)
  assert.equal(status.body.includes('FAKE_KEY'), false)
  assert.equal(api.calls.length, 0)
  assert.equal(JSON.parse((await request('compat-enable-model', { payload: target })).body).result.value.models[0].status, 'applied')
  rejection = 403
  const before = structuredClone(api.rows[0].value)
  assert.equal((await request('compat-restore-model', { payload: target })).code, 403)
  assert.deepEqual(api.rows[0].value, before)
})

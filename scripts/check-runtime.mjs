/** Optional integration check against an installed DSH runtime, without user data or network. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, symlink, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const runtime = resolve(process.argv[2] ?? '.client-build/runtime/dsh')
const artifact = process.argv[3] ? resolve(process.argv[3]) : null
const load = name => import(pathToFileURL(join(runtime, 'node_modules', '@deepseek-ai', name, 'lib/index.js')))
const { boot, loadProfileDirectory, readProfilePatches } = await load('dsh-app-boot')
const { createLaunchEnvironmentSnapshot } = await load('dsh-launch-environment')
await mkdir('.client-build', { recursive: true })
const directory = await mkdtemp(resolve('.client-build/runtime-check-'))
let plugin = resolve('lib/index.js')
const installedDirectory = artifact && (await stat(artifact)).isDirectory()
if (installedDirectory) {
  const manifest = JSON.parse(await readFile(join(artifact, 'package.json'), 'utf8'))
  plugin = join(artifact, manifest.main)
} else if (artifact) {
  execFileSync('tar', ['-xf', artifact, '-C', directory])
  plugin = join(directory, 'package/lib/index.js')
  const scope = join(directory, 'package/node_modules/@deepseek-ai')
  await mkdir(scope, { recursive: true })
  for (const dependency of ['schemastery', 'cordis']) await symlink(join(runtime, 'node_modules/@deepseek-ai', dependency), join(scope, dependency), 'junction')
}
const packageInfo = JSON.parse(await readFile(resolve(plugin, '../../package.json'), 'utf8'))
assert.equal(packageInfo.name, '@light-dawn/dsh-reasoning-effort')
const runtimeRequire = createRequire(pathToFileURL(join(runtime, 'package.json')))
const yaml = runtimeRequire('yaml')
const bundle = yaml.parse(await readFile(resolve(plugin, '../..', packageInfo.dsh.bundle.patch), 'utf8'))
assert.deepEqual(bundle[0].insert, [{ id: 'light-dawn-reasoning-effort', name: packageInfo.name }])
assert.ok((await readFile(resolve(plugin, '../client/index.js'), 'utf8')).includes(`id: "${packageInfo.name}"`))
const home = join(directory, 'home')
const dir = join(home, 'profiles', 'compat-test')
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-compat-test', private: true, dsh: { profile: { bundles: [] } } }))
await writeFile(join(dir, 'cordis.yml'), '[]\n')
const source = { providers: { arbitrary: { api: 'openai-completions', baseURL: 'https://gateway.example/v1', apiKeyEnv: 'COMPAT_TEST_FAKE_KEY',
  models: [{ id: 'model-a' }, { id: 'model-b' }], defaultContextWindow: 64000, defaultMaxTokens: 100 } } }
const location = { home, dir, name: 'compat-test', patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(runtime, 'package.json'), overlays: [] }
const modulePath = name => pathToFileURL(join(runtime, 'node_modules/@deepseek-ai', name, 'lib/index.js')).href
const rows = [
  { id: 'llm', name: modulePath('dsh-llm') },
  { id: 'config-editor', name: modulePath('dsh-config-editor') },
  { id: 'settings', name: modulePath('dsh-settings') },
  { id: 'llm-pi-ai', name: modulePath('dsh-llm-pi-ai'), config: source },
  { id: 'light-dawn-reasoning-effort', name: pathToFileURL(plugin).href },
]
await writeFile(location.patchPath, JSON.stringify([{ insert: rows }], null, 2))
const fetchOriginal = globalThis.fetch
const captured = []
let responseThinking = null
let responseTool = false
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input)
  assert.equal(url, 'https://gateway.example/v1/chat/completions')
  const body = JSON.parse(init?.body ?? await input.text())
  captured.push(body)
  const delta = { role: 'assistant', ...(responseThinking === null ? {} : { reasoning_content: responseThinking }),
    ...(responseTool ? { tool_calls: [{ index: 0, id: `call_${captured.length}`, type: 'function', function: { name: 'echo', arguments: '{"value":"ok"}' } }] } : { content: 'OK' }) }
  const chunk = (delta, finish_reason) => ({ id: 'test-response', object: 'chat.completion.chunk', model: body.model,
    choices: [{ index: 0, delta, finish_reason }] })
  return new Response([chunk(delta, null), chunk({}, responseTool ? 'tool_calls' : 'stop')].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  })
}
let ctx
let route
async function rpc(endpoint, payload) {
  const events = {}
  let body
  assert.ok(route, 'host compatibility route must be registered')
  const pending = route.handler({ method: 'POST', url: '/light-dawn-reasoning-effort/' + endpoint, headers: { 'content-type': 'application/json' },
    on: (name, callback) => { events[name] = callback } }, { writeHead: status => assert.equal(status, 200), end: value => { body = JSON.parse(value) } })
  events.data(Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'runtime-test', method: endpoint, payload })))
  events.end()
  await pending
  assert.equal(body.result.ok, true)
  return body.result.value
}
async function start() {
  const loaded = loadProfileDirectory('dsh', dir, location.installAnchor)
  return boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', location, loaded), context => {
    context.provide('profileContext', location)
    context.provide('connection', { requestRejection: () => undefined })
    context.provide('webServer', { register: value => { route = value; return () => {} } })
    context.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { COMPAT_TEST_FAKE_KEY: 'fake-key-for-local-capture' } }]))
  }, pathToFileURL(location.installAnchor).href)
}
async function waitForApplied(context) {
  for (let i = 0; i < 100; i++) {
    const section = context.get('configEditor').entries().find(row => row.options.id === 'llm-pi-ai')?.options.config
    if (section?.providers.arbitrary.models[0].compat?.thinkingFormat === 'deepseek' && section.providers.arbitrary.models[0].reasoningEfforts) return section
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('automatic configuration did not apply')
}
try {
  ctx = await start()
  let llm = ctx.get('llm')
  let settings = ctx.get('settings')
  await new Promise(resolve => setTimeout(resolve, 100))
  const beforeQuery = await readFile(location.patchPath, 'utf8')
  assert.deepEqual(ctx.get('configEditor').entries().find(row => row.options.id === 'llm-pi-ai').options.config.providers.arbitrary.models, source.providers.arbitrary.models)
  const initial = await rpc('compat-status')
  assert.equal(initial.models[0].status, 'available')
  assert.equal(await readFile(location.patchPath, 'utf8'), beforeQuery)
  assert.equal((await rpc('compat-enable-model', { provider: 'arbitrary', model: 'model-a' })).status, 'ready')
  assert.deepEqual(ctx.get('configEditor').entries().find(row => row.options.id === 'llm-pi-ai').options.config.providers.arbitrary.models[1], source.providers.arbitrary.models[1])
  await rpc('compat-enable-model', { provider: 'arbitrary', model: 'model-b' })
  await waitForApplied(ctx)
  // A saved opt-in must also work on cold startup, without reading the Settings service.
  await ctx.fiber.dispose()
  const coldDocument = yaml.parse(await readFile(location.patchPath, 'utf8'))
  const coldModels = coldDocument.findLast(row => row.id === 'llm-pi-ai').config.providers.arbitrary.models
  delete coldModels[0].reasoningEfforts
  delete coldModels[0].compat
  await writeFile(location.patchPath, yaml.stringify(coldDocument))
  ctx = await start()
  await waitForApplied(ctx)
  llm = ctx.get('llm')
  settings = ctx.get('settings')
  // Remove fields through a native edit, then observe only raw config: no status RPC may trigger maintenance.
  const update = settings.describe().find(row => row.ns === 'llm-pi-ai')
  await settings.mutate('llm-pi-ai', [
    { op: 'unset', path: ['providers', 'arbitrary', 'models', '0', 'reasoningEfforts'] },
    { op: 'unset', path: ['providers', 'arbitrary', 'models', '0', 'compat'] },
  ], update.revision)
  await waitForApplied(ctx)
  const user = { id: 'test-user', role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }
  const base = { provider: 'arbitrary', system: 'Be brief', messages: [user], maxTokens: 100 }
  const collect = async options => {
    const chunks = []
    for await (const chunk of llm.stream(options)) chunks.push(chunk)
    const finish = chunks.find(chunk => chunk.type === 'finish')
    assert.ok(finish?.replayState, JSON.stringify(finish))
    return { chunks, finish }
  }
  for (const model of ['model-a', 'model-b']) {
    const info = await llm.resolveModelInfo('arbitrary', model)
    assert.deepEqual(info.reasoning.efforts.map(item => item.id), ['off', 'low', 'high', 'max'])
    for (const reasoningEffort of ['off', 'low', 'high', 'max']) {
      await collect({ ...base, model, reasoningEffort })
      const body = captured.at(-1)
      assert.equal(body.thinking.type, reasoningEffort === 'off' ? 'disabled' : 'enabled')
      assert.equal(body.reasoning_effort, reasoningEffort === 'off' ? undefined : reasoningEffort)
      assert.deepEqual(body.messages.map(message => message.role), ['system', 'user'])
    }
  }
  await collect({ ...base, model: 'model-a' })
  assert.equal(captured.at(-1).thinking.type, 'disabled')
  // An existing profile default remains authoritative, and is never added by the plugin.
  let descriptor = settings.describe().find(row => row.ns === 'llm-pi-ai')
  await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'arbitrary', 'reasoning'], value: 'high' }], descriptor.revision)
  await collect({ ...base, model: 'model-a' })
  assert.equal(captured.at(-1).reasoning_effort, 'high')

  const tools = [{ name: 'echo', description: 'Echo a value', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }]
  for (const thinking of ['reasoned about the tool', '']) {
    const history = [user]
    for (const reasoningEffort of ['high', 'off', 'high']) {
      responseThinking = thinking
      responseTool = true
      const { chunks, finish } = await collect({ ...base, model: 'model-a', messages: history, tools, reasoningEffort })
      const body = captured.at(-1)
      for (const assistant of body.messages.filter(message => message.role === 'assistant')) assert.equal(assistant.reasoning_content, thinking)
      const content = chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block)
      const call = content.find(block => block.type === 'tool-call')
      assert.ok(call)
      history.push({ id: `assistant_${history.length}`, role: 'assistant', content,
        source: { provider: 'arbitrary', model: 'model-a', replayState: finish.replayState } })
      history.push({ id: `tool_${history.length}`, role: 'tool', toolCallId: call.id, content: [{ type: 'text', text: 'ok' }] })
    }
    responseThinking = null
    responseTool = false
    await collect({ ...base, model: 'model-a', messages: history, tools, reasoningEffort: 'high' })
    assert.equal(captured.at(-1).messages.filter(message => message.role === 'assistant').length, 3)
    for (const assistant of captured.at(-1).messages.filter(message => message.role === 'assistant')) assert.equal(assistant.reasoning_content, thinking)
  }
  descriptor = settings.describe().find(row => row.ns === 'llm-pi-ai')
  await settings.mutate('llm-pi-ai', [
    { op: 'set', path: ['providers', 'arbitrary', 'models', '0', 'compat', 'supportsDeveloperRole'], value: true },
    { op: 'set', path: ['providers', 'arbitrary', 'models', '0', 'compat', 'supportsStore'], value: false },
    { op: 'set', path: ['providers', 'arbitrary', 'models', '0', 'name'], value: 'User rename' },
  ], descriptor.revision)
  // Restore through native persistence and verify that pause survives a fresh runtime.
  await rpc('compat-restore-model', { provider: 'arbitrary', model: 'model-a' })
  const restored = await rpc('compat-restore-model', { provider: 'arbitrary', model: 'model-b' })
  assert.equal(restored.status, 'ready')
  assert.equal(restored.owned, 0)
  const expectedModels = [{ id: 'model-a', name: 'User rename', compat: { supportsDeveloperRole: true, supportsStore: false } }, { id: 'model-b' }]
  assert.deepEqual(ctx.get('configEditor').entries().find(row => row.options.id === 'llm-pi-ai').options.config.providers.arbitrary.models, expectedModels)
  await ctx.fiber.dispose()
  ctx = await start()
  await new Promise(resolve => setTimeout(resolve, 100))
  const restarted = await rpc('compat-status')
  assert.ok(restarted.models.every(model => !model.managed))
  assert.equal(restarted.owned, 0)
  assert.deepEqual(ctx.get('configEditor').entries().find(row => row.options.id === 'llm-pi-ai').options.config.providers.arbitrary.models, expectedModels)
  console.log(JSON.stringify({ runtime: JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8')).version,
    artifact: artifact ? packageInfo.version : 'workspace', requests: captured.length,
    explicitModelOptIn: true, readOnlyStatus: true, coldStartupWithoutSettingsPage: true, automaticMaintenanceWithoutSettingsPage: true, automaticPersistence: true, levels: true, toolReplay: true, restoreAndRestart: true, realNetworkRequests: 0, fixture: directory }, null, 2))
} finally {
  globalThis.fetch = fetchOriginal
  await ctx?.fiber.dispose()
}

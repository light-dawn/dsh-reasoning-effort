import { COMPAT, equal, FIELDS, endpointOf, matches, plans, record, setField, valueAt, type Change, type RecordValue } from './plan.js'
import type { CompatibilitySnapshot, CompatibilityRule, CompatibilityTarget } from '../client/compat-types.js'

export const COMPAT_NS = 'light-dawn-reasoning-effort'
export interface Descriptor { ns: string; revision: number; value?: unknown; schema?: unknown; raw?: unknown; user?: unknown }
export interface Settings {
  readonly writable: boolean
  describe(): Descriptor[]
  mutate?(ns: string, ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>, revision: number): Promise<void>
}
interface State { enabled: boolean; rules: CompatibilityRule[]; journal: Change[]; preservedJournal: unknown[]; revision: number }
export function withRawSettings(settings: Settings, editor?: { entries(): Array<{ options: { id?: string; config?: unknown } }> }): Settings {
  return {
    get writable() { return settings.writable },
    describe: () => {
      const entries = editor?.entries() ?? []
      return settings.describe().map(row => ({ ...row, raw: structuredClone(entries.find(entry => entry.options.id === row.ns)?.options.config) }))
    },
    ...(settings.mutate ? { mutate: settings.mutate.bind(settings) } : {}),
  }
}
function validRule(value: unknown): value is CompatibilityRule {
  return record(value) && typeof value.provider === 'string' && value.provider.length > 0 && typeof value.model === 'string'
    && value.model.length > 0 && typeof value.endpoint === 'string' && endpointOf(value.endpoint) === value.endpoint && value.preset === 'deepseek-four-levels'
}
function sameTarget(a: CompatibilityTarget, b?: CompatibilityTarget): boolean { return a.provider === b?.provider && a.model === b.model }

/** No endpoint or model is selected implicitly. All writes follow a saved user choice. */
export class CompatibilityController {
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private last: CompatibilitySnapshot = { enabled: true, writable: false, status: 'unsupported', models: [], owned: 0 }
  constructor(private readonly settings: Settings) {}
  close(): void { this.closed = true }
  private state(row?: Descriptor): State {
    const value = record(row?.value) ? row.value : {}
    const entries: unknown[] = Array.isArray(value.compatJournal) ? value.compatJournal : []
    const validChange = (item: unknown): item is Change => record(item)
      && typeof item.provider === 'string' && typeof item.model === 'string' && typeof item.endpoint === 'string'
      && typeof item.field === 'string' && FIELDS.includes(item.field) && record(item.before)
      && typeof item.before.present === 'boolean' && Object.hasOwn(item, 'after')
    return {
      enabled: value.autoCompat !== false,
      rules: Array.isArray(value.compatRules) ? value.compatRules.filter(validRule) : [],
      journal: entries.filter(validChange),
      // Older experimental records lack an endpoint binding. Preserve them without acting on them.
      preservedJournal: entries.filter(item => !validChange(item)),
      revision: row?.revision ?? -1,
    }
  }
  private async save(state: State): Promise<void> {
    if (!this.settings.mutate || this.closed) throw new Error('unavailable')
    await this.settings.mutate(COMPAT_NS, [
      { op: 'set', path: ['autoCompat'], value: state.enabled },
      { op: 'set', path: ['compatRules'], value: state.rules },
      { op: 'set', path: ['compatJournal'], value: [...state.journal, ...state.preservedJournal] },
    ], state.revision)
    const saved = this.settings.describe().find(row => row.ns === COMPAT_NS)
    if (!record(saved?.value) || saved.value.autoCompat !== state.enabled || !equal(saved.value.compatRules, state.rules)
      || !equal(saved.value.compatJournal, [...state.journal, ...state.preservedJournal])) throw new Error('journal conflict')
    state.revision = saved.revision
  }
  run(action: 'status' | 'scan' | 'enable-model' | 'restore-model' | 'repair' = 'scan', target?: CompatibilityTarget): Promise<CompatibilitySnapshot> {
    const task = this.queue.then(() => this.perform(action, target))
    this.queue = task.catch(() => undefined)
    return task
  }
  private snapshot(llm: Descriptor | undefined, state: State, supported: boolean): CompatibilitySnapshot {
    const modelPlans = plans(llm?.raw, state.rules)
    const models: CompatibilitySnapshot['models'] = []
    const providers = record(llm?.raw) && record(llm.raw.providers) ? llm.raw.providers : {}
    for (const [provider, route] of Object.entries(providers)) {
      if (!record(route) || !Array.isArray(route.models)) continue
      for (const model of route.models) {
        if (!record(model) || typeof model.id !== 'string') continue
        const plan = modelPlans.find(item => item.provider === provider && item.model === model.id)
        const applied = state.journal.some(item => item.provider === provider && item.model === model.id)
        const managed = applied || state.rules.some(rule => rule.provider === provider && rule.model === model.id)
        models.push({ provider, model: model.id, name: typeof model.name === 'string' ? model.name : model.id, managed,
          status: plan?.status === 'compatible' && applied ? 'applied' : plan?.status
            ?? (model.reasoningEfforts === false ? 'disabled' : route.api === 'openai-completions' && endpointOf(route.baseURL) ? 'available' : 'unsupported'),
          conflicts: plan?.conflicts ?? [] })
      }
    }
    // Keep a moved/deleted target visible so an old opt-in cannot silently follow it.
    for (const plan of modelPlans) if (!models.some(item => sameTarget(item, plan))) models.push({ ...plan, managed: true })
    return { enabled: state.enabled, writable: supported, status: supported ? 'ready' : 'unsupported', models, owned: state.journal.length }
  }
  private async perform(action: string, target?: CompatibilityTarget): Promise<CompatibilitySnapshot> {
    if (this.closed) return this.last
    let state: State = { enabled: true, rules: [], journal: [], preservedJournal: [], revision: -1 }
    try {
      const rows = this.settings.describe()
      const own = rows.find(row => row.ns === COMPAT_NS)
      let llm = rows.find(row => row.ns === 'llm-pi-ai')
      state = this.state(own)
      const supported = this.settings.writable === true && typeof this.settings.mutate === 'function' && !!own && !!llm
        && record(llm.raw) && ['reasoningEfforts', ...Object.keys(COMPAT)].every(field => JSON.stringify(llm?.schema ?? {}).includes(field))
      this.last = this.snapshot(llm, state, supported)
      if (!supported || !llm || !record(llm.raw) || !record(llm.raw.providers) || action === 'status') return this.last
      if (action !== 'scan' && !target) throw new Error('missing target')
      if (action === 'restore-model') {
        state.rules = state.rules.filter(rule => !sameTarget(rule, target))
        await this.save(state)
        llm = this.settings.describe().find(row => row.ns === 'llm-pi-ai')!
        const providers = record(llm.raw) && record(llm.raw.providers) ? llm.raw.providers : {}
        const arrays = new Map<string, unknown[]>()
        for (const change of state.journal.filter(item => sameTarget(item, target))) {
          const route = providers[change.provider]
          if (!record(route) || !matches(route, change.endpoint) || !Array.isArray(route.models)) continue
          const models = arrays.get(change.provider) ?? structuredClone(route.models)
          const found = models.filter(model => record(model) && model.id === change.model)
          if (found.length !== 1 || !record(found[0])) continue
          const current = valueAt(found[0], change.field)
          if (!current.present || !equal(current.value, change.after)) continue
          setField(found[0], change.field, change.before)
          arrays.set(change.provider, models)
        }
        if (arrays.size) await this.writeArrays(llm, arrays)
        state.journal = state.journal.filter(item => !sameTarget(item, target))
        await this.save(state)
      } else {
        if (action === 'enable-model') {
          const route = llm.raw.providers[target!.provider]
          const endpoint = record(route) ? endpointOf(route.baseURL) : undefined
          if (!record(route) || route.api !== 'openai-completions' || !endpoint || !Array.isArray(route.models)
            || route.models.filter(model => record(model) && model.id === target!.model).length !== 1) throw new Error('unsupported target')
          state.enabled = true
          state.rules = [...state.rules.filter(rule => !sameTarget(rule, target)), { ...target!, endpoint, preset: 'deepseek-four-levels' }]
          await this.save(state)
          llm = this.settings.describe().find(row => row.ns === 'llm-pi-ai')!
        }
        if (state.enabled) {
          const section = llm.raw as RecordValue
          const providers = section.providers as RecordValue
          const changes = plans(section, state.rules, action === 'repair' ? target : undefined).flatMap(plan => plan.changes)
          const arrays = new Map<string, unknown[]>()
          for (const change of changes) {
            const route = providers[change.provider] as RecordValue
            const models = arrays.get(change.provider) ?? structuredClone(route.models as unknown[])
            const model = models.find(item => record(item) && item.id === change.model) as RecordValue
            setField(model, change.field, { present: true, value: change.after })
            arrays.set(change.provider, models)
            const old = state.journal.find(item => sameTarget(item, change) && item.field === change.field && item.endpoint === change.endpoint)
            if (!old || !equal(change.before.value, old.after)) {
              state.journal = state.journal.filter(item => item !== old)
              state.journal.push(change)
            }
          }
          if (changes.length) { await this.save(state); await this.writeArrays(llm, arrays) }
        }
      }
      const verified = this.settings.describe().find(row => row.ns === 'llm-pi-ai')
      this.last = this.snapshot(verified, state, supported)
      if (state.enabled && plans(verified?.raw, state.rules).some(plan => plan.changes.length)) this.last.status = 'failed'
    } catch {
      this.last = { ...this.last, status: 'failed', owned: state.journal.length }
    }
    return this.last
  }
  private async writeArrays(row: Descriptor, arrays: Map<string, unknown[]>): Promise<void> {
    if (this.closed) throw new Error('disposed')
    await this.settings.mutate!('llm-pi-ai', [...arrays].map(([provider, models]) => ({ op: 'set', path: ['providers', provider, 'models'], value: models })), row.revision)
  }
}

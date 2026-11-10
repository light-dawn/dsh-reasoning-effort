/** Endpoint-scoped edits. Never include credentials or whole provider snapshots. */
import type { CompatibilityRule, ModelStatus } from '../client/compat-types.js'
export type RecordValue = Record<string, unknown>
export const EFFORTS = { off: null, low: 'low', high: 'high', max: 'max' }
export const COMPAT = {
  thinkingFormat: 'deepseek',
  supportsDeveloperRole: false,
  requiresReasoningContentOnAssistantMessages: true,
}
export const FIELDS = ['reasoningEfforts', 'compat', ...Object.keys(COMPAT).map(key => `compat.${key}`)]
export interface Change {
  provider: string
  model: string
  endpoint: string
  field: string
  before: { present: boolean; value?: unknown; parentPresent?: boolean }
  after: unknown
}
export interface ModelPlan {
  provider: string
  model: string
  status: ModelStatus
  conflicts: string[]
  changes: Change[]
}
export function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function expression(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(expression)
  return record(value) && (Object.hasOwn(value, '__jsExpr') || Object.values(value).some(expression))
}
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (record(a) && record(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]))
  }
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equal(value, b[i]))
}
export function endpointOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined
    return url.origin + url.pathname.replace(/\/+$/u, '')
  } catch { return undefined }
}
export function matches(route: RecordValue, endpoint: string): boolean {
  return route.api === 'openai-completions' && endpointOf(route.baseURL) === endpoint
}
export function valueAt(model: RecordValue, field: string): Change['before'] {
  const parts = field.split('.')
  const parent = parts.length === 1 ? model : model.compat
  const key = parts.at(-1)!
  return { ...(parts.length > 1 ? { parentPresent: Object.hasOwn(model, 'compat') } : {}),
    ...(record(parent) && Object.hasOwn(parent, key) ? { present: true, value: parent[key] } : { present: false }) }
}
export function setField(model: RecordValue, field: string, state: Change['before']): void {
  const parts = field.split('.')
  if (parts.length > 1 && !record(model.compat)) model.compat = {}
  const parent = parts.length === 1 ? model : model.compat as RecordValue
  if (state.present) parent[parts.at(-1)!] = structuredClone(state.value)
  else delete parent[parts.at(-1)!]
  if (parts.length > 1 && Object.keys(parent).length === 0 && state.parentPresent === false) delete model.compat
}
export function plans(section: unknown, rules: readonly CompatibilityRule[], repair?: { provider: string; model: string }): ModelPlan[] {
  if (!record(section) || !record(section.providers)) return []
  const result: ModelPlan[] = []
  const seen = new Set<string>()
  for (const rule of rules) {
    const { provider, endpoint } = rule
    const key = JSON.stringify([provider, rule.model])
    if (seen.has(key) || rule.preset !== 'deepseek-four-levels') continue
    seen.add(key)
    const plan: ModelPlan = { provider, model: rule.model, status: 'compatible', conflicts: [], changes: [] }
    result.push(plan)
    const route = section.providers[provider]
    const candidates = record(route) && Array.isArray(route.models) ? route.models.filter(model => record(model) && model.id === rule.model) : []
    if (!record(route) || !matches(route, endpoint) || candidates.length !== 1) { plan.status = 'unsupported'; continue }
    const model = candidates[0] as RecordValue
    if (expression(model) || expression(route.compat)) { plan.status = 'unsupported'; continue }
    if (model.reasoningEfforts === false) { plan.status = 'disabled'; continue }
    const forced = repair?.provider === provider && repair.model === model.id
    const desired: RecordValue = { reasoningEfforts: EFFORTS, ...Object.fromEntries(Object.entries(COMPAT).map(([key, value]) => [`compat.${key}`, value])) }
    if (Object.hasOwn(model, 'compat') && !record(model.compat)) {
      plan.conflicts.push('compat')
      if (forced) plan.changes.push({ provider, model: String(model.id), endpoint, field: 'compat', before: valueAt(model, 'compat'), after: COMPAT })
    }
    for (const [field, after] of Object.entries(desired)) {
      const before = valueAt(model, field)
      const inherited = field.startsWith('compat.') && !before.present && record(route.compat)
        ? valueAt({ compat: route.compat }, field) : before
      if (equal(inherited.value, after) && inherited.present) continue
      // A malformed explicit compat block is a conflict too, including null.
      const blocked = field.startsWith('compat.') && Object.hasOwn(model, 'compat') && !record(model.compat)
      if (blocked) continue
      if (inherited.present) {
        plan.conflicts.push(field)
        if (!forced) continue
      }
      plan.changes.push({ provider, model: String(model.id), endpoint, field, before, after })
    }
    // Leave a conflicting model entirely alone until the user repairs it.
    if (plan.conflicts.length && !forced) plan.changes = []
    plan.status = plan.conflicts.length && (!forced || plan.changes.length === 0) ? 'conflict'
      : plan.changes.length ? 'detected' : 'compatible'
  }
  return result
}

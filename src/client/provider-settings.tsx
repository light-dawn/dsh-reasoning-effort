import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, type ReasoningEffortLocaleKey } from './locales.js'
import type { CompatibilityAction, CompatibilitySnapshot, CompatibilityTarget } from './compat-types.js'

/** DSH 0.2.2 provider-card extension contract; this slot does not replace its editor. */
interface ProviderCardOwner {
  provider: { provider: string; settingsNs: string; displayName: string; declared?: boolean }
  configured: boolean
  keyConfigured: boolean
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.models.provider-card': { kind: 'keyed'; scope: 'root'; owner: ProviderCardOwner }
  }
}
interface CompatibilityApi {
  compatibility(action?: CompatibilityAction, target?: CompatibilityTarget): Promise<CompatibilitySnapshot | null>
  subscribe(listener: () => void): () => void
  getSnapshot(): number
  invalidate(): void
}
const subscribeNothing = () => () => {}
const noRevision = () => 0

export function ProviderCompatibility({ provider, configured, t, adapt }: ProviderCardOwner & PropsLocale<typeof NS> & { adapt: CompatibilityApi | null }) {
  const revision = useSyncExternalStore(adapt?.subscribe ?? subscribeNothing, adapt?.getSnapshot ?? noRevision)
  const [snapshot, setSnapshot] = useState<CompatibilitySnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const eligible = configured && provider.settingsNs === 'llm-pi-ai' && provider.declared !== false
  useEffect(() => {
    let active = true
    if (!eligible || !adapt) return
    void adapt.compatibility().then(value => {
      if (!active) return
      setSnapshot(value)
      if (value === null) setFailed(true)
    })
    return () => { active = false }
  }, [eligible, provider.provider, adapt, revision])
  if (!eligible || !adapt) return null
  const models = snapshot?.models.filter(model => model.provider === provider.provider) ?? []
  const perform = async (action: CompatibilityAction, model: string) => {
    if (busy) return
    setBusy(model)
    setFailed(false)
    const value = await adapt.compatibility(action, { provider: provider.provider, model })
    setSnapshot(value)
    setFailed(value === null || value.status === 'failed')
    setBusy(null)
    adapt.invalidate()
  }
  const fieldNames: Record<string, ReasoningEffortLocaleKey> = {
    reasoningEfforts: 'compat.field.efforts', compat: 'compat.field.request',
    'compat.thinkingFormat': 'compat.field.format', 'compat.supportsDeveloperRole': 'compat.field.role',
    'compat.requiresReasoningContentOnAssistantMessages': 'compat.field.history',
  }
  return <section className="re-provider-compat" aria-label={t('compat.title')}>
    <div className="re-provider-compat-heading">{t('compat.title')}</div>
    <p className="re-provider-compat-description">{t('compat.description')}</p>
    {failed && <p className="re-provider-compat-error" role="alert">{t('compat.failed')}</p>}
    {!snapshot ? <p className="re-provider-compat-description" role="status">{t('guidance.checking')}</p>
      : !snapshot.writable ? <p className="re-provider-compat-description" role="status">{t('compat.unsupported')}</p>
      : models.length === 0 ? <p className="re-provider-compat-description">{t('compat.empty')}</p>
      : models.map(model => <div className="re-provider-compat-model" key={model.model}>
        <div className="re-provider-compat-row">
          <div className="re-provider-compat-copy">
            <span className="re-provider-compat-name">{model.name ?? model.model}</span>
            {(model.status === 'applied' || model.status === 'compatible') && model.managed
              && <span className="re-provider-compat-ready" role="status">{t('compat.applied')}</span>}
          </div>
          <button type="button" className="re-provider-compat-button" disabled={busy !== null || (!model.managed && ['disabled', 'unsupported'].includes(model.status))}
            title={model.managed ? t('compat.restoreNote') : undefined}
            onClick={() => { void perform(model.managed ? 'restore-model' : 'enable-model', model.model) }}>
            {busy === model.model ? t('compat.saving') : model.managed ? t('compat.restore') : model.status === 'disabled' ? t('compat.disabled')
              : model.status === 'unsupported' ? t('compat.unsupportedModel') : t('compat.enable')}
          </button>
        </div>
        {model.status === 'conflict' && <details className="re-provider-compat-conflict">
          <summary>{t('compat.conflict')}</summary>
          <p>{t('compat.fields', { fields: model.conflicts.map(field => fieldNames[field] ? t(fieldNames[field]) : field).join(' / ') })}</p>
          <button className="re-provider-compat-button" type="button" disabled={busy !== null}
            onClick={() => { void perform('repair', model.model) }}>{t('compat.repair')}</button>
        </details>}
      </div>)}
  </section>
}

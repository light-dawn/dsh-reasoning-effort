import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales.js';
import type { CompatibilityAction, CompatibilitySnapshot, CompatibilityTarget } from './compat-types.js';
/** DSH 0.2.2 provider-card extension contract; this slot does not replace its editor. */
interface ProviderCardOwner {
    provider: {
        provider: string;
        settingsNs: string;
        displayName: string;
        declared?: boolean;
    };
    configured: boolean;
    keyConfigured: boolean;
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        'settings.models.provider-card': {
            kind: 'keyed';
            scope: 'root';
            owner: ProviderCardOwner;
        };
    }
}
interface CompatibilityApi {
    compatibility(action?: CompatibilityAction, target?: CompatibilityTarget): Promise<CompatibilitySnapshot | null>;
    subscribe(listener: () => void): () => void;
    getSnapshot(): number;
    invalidate(): void;
}
export declare function ProviderCompatibility({ provider, configured, t, adapt }: ProviderCardOwner & PropsLocale<typeof NS> & {
    adapt: CompatibilityApi | null;
}): import("react").JSX.Element | null;
export {};

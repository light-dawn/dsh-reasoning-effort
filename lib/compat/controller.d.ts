import type { CompatibilitySnapshot, CompatibilityTarget } from '../client/compat-types.js';
export declare const COMPAT_NS = "light-dawn-reasoning-effort";
export interface Descriptor {
    ns: string;
    revision: number;
    value?: unknown;
    schema?: unknown;
    raw?: unknown;
    user?: unknown;
}
export interface Settings {
    readonly writable: boolean;
    describe(): Descriptor[];
    mutate?(ns: string, ops: Array<{
        op: 'set' | 'unset';
        path: string[];
        value?: unknown;
    }>, revision: number): Promise<void>;
}
export declare function withRawSettings(settings: Settings, editor?: {
    entries(): Array<{
        options: {
            id?: string;
            config?: unknown;
        };
    }>;
}): Settings;
/** No endpoint or model is selected implicitly. All writes follow a saved user choice. */
export declare class CompatibilityController {
    private readonly settings;
    private queue;
    private closed;
    private last;
    constructor(settings: Settings);
    close(): void;
    private state;
    private save;
    run(action?: 'status' | 'scan' | 'enable-model' | 'restore-model' | 'repair', target?: CompatibilityTarget): Promise<CompatibilitySnapshot>;
    private snapshot;
    private perform;
    private writeArrays;
}

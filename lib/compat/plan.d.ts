/** Endpoint-scoped edits. Never include credentials or whole provider snapshots. */
import type { CompatibilityRule, ModelStatus } from '../client/compat-types.js';
export type RecordValue = Record<string, unknown>;
export declare const EFFORTS: {
    off: null;
    low: string;
    high: string;
    max: string;
};
export declare const COMPAT: {
    thinkingFormat: string;
    supportsDeveloperRole: boolean;
    requiresReasoningContentOnAssistantMessages: boolean;
};
export declare const FIELDS: string[];
export interface Change {
    provider: string;
    model: string;
    endpoint: string;
    field: string;
    before: {
        present: boolean;
        value?: unknown;
        parentPresent?: boolean;
    };
    after: unknown;
}
export interface ModelPlan {
    provider: string;
    model: string;
    status: ModelStatus;
    conflicts: string[];
    changes: Change[];
}
export declare function record(value: unknown): value is RecordValue;
export declare function equal(a: unknown, b: unknown): boolean;
export declare function endpointOf(value: unknown): string | undefined;
export declare function matches(route: RecordValue, endpoint: string): boolean;
export declare function valueAt(model: RecordValue, field: string): Change['before'];
export declare function setField(model: RecordValue, field: string, state: Change['before']): void;
export declare function plans(section: unknown, rules: readonly CompatibilityRule[], repair?: {
    provider: string;
    model: string;
}): ModelPlan[];

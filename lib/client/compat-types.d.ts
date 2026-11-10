/** Public RPC shape shared by host and browser; contains no credentials. */
export type ModelStatus = 'available' | 'detected' | 'applied' | 'compatible' | 'conflict' | 'disabled' | 'unsupported' | 'failed';
export interface CompatibilityRule {
    provider: string;
    model: string;
    endpoint: string;
    preset: 'deepseek-four-levels';
}
export interface CompatibilityTarget {
    provider: string;
    model: string;
}
export type CompatibilityAction = 'status' | 'enable-model' | 'restore-model' | 'repair';
export interface CompatibilitySnapshot {
    enabled: boolean;
    writable: boolean;
    status: 'ready' | 'unsupported' | 'failed';
    models: Array<{
        provider: string;
        model: string;
        name?: string;
        status: ModelStatus;
        conflicts: string[];
        managed?: boolean;
    }>;
    owned: number;
}

export interface ScaffoldOptions {
    appName: string;
    useTs: boolean;
    horizonUrl?: string;
    sorobanUrl?: string;
    wallets?: string[];
    defaults?: boolean;
}
export declare function scaffold(options: ScaffoldOptions): Promise<void>;

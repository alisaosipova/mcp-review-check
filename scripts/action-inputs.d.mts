// Types for scripts/action-inputs.mjs (imported by test/docs.test.ts).
export declare const ACTION: string;
export declare const GUIDE: string;
export declare const START: string;
export declare const END: string;
export declare function actionInputs(text?: string): { name: string; description: string; default: string }[];
export declare function actionInputsTable(inputs?: { name: string; description: string; default: string }[]): string;
export declare function withTable(guide: string, table?: string): string;

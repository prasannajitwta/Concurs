export interface AgentOutput {
    displayMessage(role: 'user' | 'assistant', content: string): void;
    displayError(error: string): void;
    displayFileEdit(filePath: string, content: string, isNew: boolean): void;
    displayToolResult(tool: string, result: unknown): void;
}

export interface AzureConfig {
    endpoint: string;
    deployment: string;
    apiVersion: string;
    apiKey: string;
}

export interface ContextFile {
    path: string;
    content: string;
}

export interface SearchResult {
    filePath: string;
    lineNumber: number;
    line: string;
}

export interface SearchOptions {
    isRegex?: boolean;
    maxResults?: number;
    includeExtensions?: string[];
    excludeDirs?: string[];
}

export type ContextMode = 'manual' | 'smart' | 'hybrid';

export interface SmartContextOptions {
    mode?: ContextMode;
    tokenBudget?: number;
    includeFileTree?: boolean;
    maxChunks?: number;
}

export interface SmartContextChunk {
    file: string;
    content: string;
    relevance: string;
}

export interface SmartContextMetadata {
    mode: ContextMode;
    includedFileTree: boolean;
    uploadedFiles: number;
    matchedFiles: number;
    chunks: number;
    estimatedTokens: number;
}

export interface SmartContextResult {
    formattedContext: string;
    chunks: SmartContextChunk[];
    metadata: SmartContextMetadata;
}

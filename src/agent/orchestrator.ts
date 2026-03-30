import * as vscode from 'vscode';
import { ConfigManager } from '../config/configManager';
import { CoreAgent } from '../core/agent';
import { ContextFile } from '../core/types';

/**
 * VS Code-aware thin wrapper over CoreAgent.
 * Resolves the workspace root path from the VS Code API and delegates
 * all LLM interactions to CoreAgent (which has no vscode dependency).
 */
export class Agent {
    private core: CoreAgent;

    constructor(private configManager: ConfigManager) {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        this.core = new CoreAgent(rootPath);

        // Keep rootPath in sync when the user opens/closes workspace folders
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (newRoot) {
                this.core.setRootPath(newRoot);
            }
        });
    }

    public async handleMessage(userMessage: string, currentFilePath?: string): Promise<string> {
        const config = await this.configManager.getConfig();
        // apiKey comes from VS Code secrets which types as string|undefined;
        // treat it as string since ConfigManager validates presence before use.
        return this.core.handleMessage(userMessage, config as import('../core/types').AzureConfig, currentFilePath);
    }

    public async ingestFiles(files: ContextFile[]): Promise<void> {
        return this.core.ingestFiles(files);
    }

    public removeFile(filePath: string): void {
        this.core.removeFile(filePath);
    }

    public async clearFiles(): Promise<void> {
        return this.core.clearFiles();
    }

    public getFileStore(): Map<string, string> {
        return this.core.getFileStore();
    }
}
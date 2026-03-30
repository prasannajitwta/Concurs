import * as fs from 'fs';
import * as path from 'path';
import { CoreAgent } from '../core/agent';
import { AzureConfig, AgentOutput } from '../core/types';
import { traceImports } from '../core/context';

// File-edit block format emitted by the LLM
const FILE_BLOCK_RE = /===FILE:\s*(.+?)\s*\|\s*(CREATE|EDIT)\s*===\n([\s\S]*?)(?====FILE:|$)/g;

export class CliAgent implements AgentOutput {
    private core: CoreAgent;
    private config: AzureConfig;

    constructor(rootPath: string) {
        this.core = new CoreAgent(rootPath);
        this.config = this.readConfigFromEnv();
    }

    // ─── AgentOutput interface ─────────────────────────────────────────────────

    displayMessage(role: 'user' | 'assistant', content: string): void {
        const prefix = role === 'user' ? '\nYou: ' : '\nAssistant:\n';
        process.stdout.write(prefix + content + '\n');
    }

    displayError(error: string): void {
        process.stderr.write(`\n[Error] ${error}\n`);
    }

    displayFileEdit(filePath: string, _content: string, isNew: boolean): void {
        const action = isNew ? 'Created' : 'Edited';
        process.stdout.write(`  ✓ ${action}: ${filePath}\n`);
    }

    displayToolResult(tool: string, result: unknown): void {
        process.stdout.write(`\n[${tool}]:\n${JSON.stringify(result, null, 2)}\n`);
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    public async handleMessage(text: string): Promise<void> {
        this.displayMessage('user', text);
        try {
            const response = await this.core.handleMessage(text, this.config);
            this.displayMessage('assistant', response);
            this.applyFileEdits(response);
        } catch (err) {
            this.displayError(err instanceof Error ? err.message : String(err));
        }
    }

    public addFile(filePath: string): void {
        const abs = path.resolve(filePath);
        try {
            const content = fs.readFileSync(abs, 'utf8');
            this.core.ingestFiles([{ path: abs, content }]);
            process.stdout.write(`  ✓ Added to context: ${abs}\n`);
        } catch (err) {
            this.displayError(`Could not read file "${abs}": ${err}`);
        }
    }

    public traceAndAddImports(filePath: string, rootPath: string): void {
        const abs = path.resolve(filePath);
        try {
            const traced = traceImports(abs, rootPath);
            this.core.ingestFiles(traced);
            process.stdout.write(`  ✓ Traced ${traced.length} file(s) from: ${abs}\n`);
            traced.forEach(f => process.stdout.write(`    • ${f.path}\n`));
        } catch (err) {
            this.displayError(`Trace failed: ${err}`);
        }
    }

    public listContextFiles(): void {
        const store = this.core.getFileStore();
        if (store.size === 0) {
            process.stdout.write('  (no files in context)\n');
        } else {
            process.stdout.write(`  Context files (${store.size}):\n`);
            store.forEach((_, p) => process.stdout.write(`    • ${p}\n`));
        }
    }

    public clearContext(): void {
        this.core.clearFiles();
        process.stdout.write('  ✓ Context cleared\n');
    }

    // ─── Private helpers ───────────────────────────────────────────────────────

    private readConfigFromEnv(): AzureConfig {
        const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
        const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'];
        const apiKey = process.env['AZURE_OPENAI_API_KEY'];
        const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-02-01';

        if (!endpoint || !deployment || !apiKey) {
            const missing = [
                !endpoint && 'AZURE_OPENAI_ENDPOINT',
                !deployment && 'AZURE_OPENAI_DEPLOYMENT',
                !apiKey && 'AZURE_OPENAI_API_KEY',
            ].filter(Boolean).join(', ');
            throw new Error(`Missing required environment variables: ${missing}`);
        }

        return { endpoint, deployment, apiKey, apiVersion };
    }

    /** Parse and write ===FILE:...|MODE=== blocks produced by the LLM to disk. */
    private applyFileEdits(response: string): void {
        FILE_BLOCK_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = FILE_BLOCK_RE.exec(response)) !== null) {
            const [, filePath, mode, content] = match;
            const abs = path.resolve(filePath.trim());
            const isNew = mode === 'CREATE';
            try {
                fs.mkdirSync(path.dirname(abs), { recursive: true });
                fs.writeFileSync(abs, content.trim() + '\n', 'utf8');
                this.displayFileEdit(abs, content, isNew);
            } catch (err) {
                this.displayError(`Could not write "${abs}": ${err}`);
            }
        }
    }
}

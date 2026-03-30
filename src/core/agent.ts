import { AzureConfig, ContextFile } from './types';
import { gatherSmartContext } from './context';

const SYSTEM_PROMPT = `You are a helpful VS Code Copilot-like coding assistant. You can automatically apply code changes to files.

## IMPORTANT FORMATTING RULES:

1. **Code Blocks**: Always wrap code in triple backticks with language specifier:
   \`\`\`typescript
   // code here
   \`\`\`

2. **File References**: When discussing specific files, use clear headers:
   ### File: filename.ts
   
3. **Formatting**: 
   - Use **bold** for important concepts
   - Use *italic* for emphasis
   - Separate thoughts with line breaks
   - Each code snippet in its own block
   
4. **Structure**: 
   - Start with brief explanation
   - Show code examples
   - Provide implementation details
   - End with key takeaways

5. **Never compress output** - use proper markdown formatting for readability

## AUTOMATIC FILE EDITING:

When you need to modify or create files, format them like this:

===FILE: src/path/to/file.ts|EDIT===
// Complete updated file content
// Include all code needed
===FILE: src/new/file.ts|CREATE===
// New file content goes here

The system will automatically:
- EDIT: Replace existing file contents
- CREATE: Create new files in the workspace
- Open modified files in the editor for review

Always provide the complete file content, not just changes.`;

export class CoreAgent {
    private fileStore: Map<string, string> = new Map();
    private rootPath?: string;

    constructor(rootPath?: string) {
        this.rootPath = rootPath;
    }

    public setRootPath(rootPath: string): void {
        this.rootPath = rootPath;
    }

    public async handleMessage(userMessage: string, config: AzureConfig, currentFilePath?: string): Promise<string> {
        const smartContext = gatherSmartContext({
            rootPath: this.rootPath,
            userQuery: userMessage,
            uploadedFiles: this.fileStore,
            currentFilePath,
            options: {
                mode: 'hybrid',
                tokenBudget: 28000,
                // Include tree only for broad requests (inside gatherSmartContext).
                includeFileTree: undefined,
                maxChunks: 14,
            },
        });

        const contextSections = smartContext.formattedContext || 'No relevant context found. Proceed with best effort and request files if needed.';

        const userPrompt = `${contextSections}\n\n## CONTEXT METADATA:\n- Mode: ${smartContext.metadata.mode}\n- Chunks: ${smartContext.metadata.chunks}\n- Estimated tokens: ${smartContext.metadata.estimatedTokens}\n\n## USER REQUEST:\n${userMessage}\n\nProvide a clear, well-formatted response using proper markdown formatting.`;

        const apiUrl = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': config.apiKey,
            },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                model: config.deployment,
                max_completion_tokens: 4000,
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Azure API Error: ${response.status} - ${errorData}`);
        }

        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        return data.choices[0].message.content;
    }

    public async ingestFiles(files: ContextFile[]): Promise<void> {
        for (const f of files) {
            this.fileStore.set(f.path, f.content);
        }
    }

    public removeFile(filePath: string): void {
        this.fileStore.delete(filePath);
    }

    public async clearFiles(): Promise<void> {
        this.fileStore.clear();
    }

    public getFileStore(): Map<string, string> {
        return this.fileStore;
    }
}

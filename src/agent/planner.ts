import { ConfigManager } from '../config/configManager';
import { gatherSmartContext } from '../core/context';

interface SolutionApproach {
    id: string;
    name: string;
    description: string;
    approach: string;
    pros: string[];
    cons: string[];
    estimatedTime: string;
    complexity: 'Low' | 'Medium' | 'High';
    tools: string[];
}

interface DetailedPlan {
    title: string;
    overview: string;
    steps: string[];
    fileEdits: Array<{ path: string; mode: 'CREATE' | 'EDIT'; description: string }>;
}

export class PlanningAgent {
    constructor(
        private configManager: ConfigManager,
        private fileStore: Map<string, string>,
        private rootPath?: string,
    ) {}

    public async generatePlan(userRequest: string): Promise<SolutionApproach[]> {
        const config = await this.configManager.getConfig();
        
        const systemPrompt = `You are a planning agent that generates multiple solution approaches for development tasks.
        
IMPORTANT: Respond ONLY with valid JSON, no other text.

Generate 4-5 different approaches as a JSON array. Each approach must have:
- id: unique identifier (e.g., "approach_1")
- name: short name (3-5 words)
- description: one sentence overview
- approach: detailed strategy (2-3 sentences)
- pros: array of 3-4 advantages
- cons: array of 2-3 disadvantages
- estimatedTime: e.g. "2 hours", "1 day", "3 days"
- complexity: "Low", "Medium", or "High"
- tools: array of tools/technologies needed

Example JSON structure:
[
  {
    "id": "approach_1",
    "name": "Approach Name",
    "description": "Brief description",
    "approach": "Detailed strategy...",
    "pros": ["Pro 1", "Pro 2"],
    "cons": ["Con 1"],
    "estimatedTime": "2 hours",
    "complexity": "Low",
    "tools": ["TypeScript", "VS Code API"]
  }
]`;

        const fileContext = this.formatFileContext(userRequest);
        
        const userPrompt = `${fileContext}

User Request: ${userRequest}

Generate 4-5 different solution approaches as JSON.`;

        try {
            const response = await this.callAzureOpenAI(systemPrompt, userPrompt);
            
            // Try to parse JSON directly
            let approaches = this.parseJsonResponse(response);
            
            if (!approaches || approaches.length === 0) {
                throw new Error('Failed to parse valid approaches from response');
            }
            
            return approaches;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to generate plan: ${errorMsg}`);
        }
    }

    public async getDetailedPlan(approachId: string, selectedApproach: SolutionApproach, userRequest: string): Promise<string> {
        const config = await this.configManager.getConfig();
        
        const systemPrompt = `You are a detailed implementation planner. Generate a comprehensive step-by-step implementation plan.

IMPORTANT: Include file edits using this format:
===FILE: path/to/file.ts|CREATE===
file content here
===FILE: path/to/file2.ts|EDIT===
file content here

Guidelines:
1. Break down implementation into clear numbered steps
2. Explain reasoning for each step
3. Provide complete code for new files
4. Use the FILE markers for all changes
5. Use code blocks with language specifiers for clarity
6. Focus on the actual implementation details`;

        const fileContext = this.formatFileContext(userRequest);
        
        const userPrompt = `${fileContext}

Original Request: ${userRequest}

Selected Approach: ${selectedApproach.name}
Strategy: ${selectedApproach.approach}

Generate a detailed step-by-step implementation plan with file edits in the ===FILE:...=== format.`;

        try {
            const response = await this.callAzureOpenAI(systemPrompt, userPrompt);
            return response;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to generate detailed plan: ${errorMsg}`);
        }
    }

    private async callAzureOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
        const config = await this.configManager.getConfig();
        
        const apiUrl = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': config.apiKey as string
            } as Record<string, string>,
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                model: config.deployment,
                max_completion_tokens: 20000
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Azure API Error: ${response.status} - ${errorData}`);
        }

        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        return data.choices[0].message.content;
    }

    private formatFileContext(userRequest: string): string {
        const smart = gatherSmartContext({
            rootPath: this.rootPath,
            userQuery: userRequest,
            uploadedFiles: this.fileStore,
            options: {
                mode: 'hybrid',
                tokenBudget: 22000,
                includeFileTree: undefined,
                maxChunks: 12,
            },
        });

        if (!smart.formattedContext.trim()) {
            return 'No files in context.';
        }

        return `${smart.formattedContext}\n\n## CONTEXT METADATA:\n- Mode: ${smart.metadata.mode}\n- Chunks: ${smart.metadata.chunks}\n- Estimated tokens: ${smart.metadata.estimatedTokens}`;
    }

    private parseJsonResponse(response: string): SolutionApproach[] {
        try {
            // Try direct JSON parse
            try {
                const parsed = JSON.parse(response);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            } catch (e) {
                // Not direct JSON, try to extract from code block
            }

            // Try to extract JSON from ```json...``` code block
            const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
            if (jsonMatch && jsonMatch[1]) {
                const parsed = JSON.parse(jsonMatch[1]);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }

            // Fallback: try to find JSON array in response
            const arrayMatch = response.match(/\[\s*{[\s\S]*}\s*\]/);
            if (arrayMatch) {
                const parsed = JSON.parse(arrayMatch[0]);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }

            throw new Error('Could not find valid JSON array in response');
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`JSON parse error: ${errorMsg}`);
        }
    }
}

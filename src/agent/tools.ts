import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function readFile(path: string): Promise<string> {
    const uri = vscode.Uri.file(path);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
}

export async function writeFile(path: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(path);
    const bytes = Buffer.from(content, 'utf8');
    await vscode.workspace.fs.writeFile(uri, bytes);
}

export async function listFiles(root: string): Promise<string[]> {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return [];
    }
    // collect up to 2000 files, excluding node_modules
    const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 2000);
    return uris.map(u => u.fsPath);
}

export async function executeCommand(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
    const options = cwd ? { cwd } : undefined;
    try {
        const { stdout, stderr } = await execAsync(command, options);
        return { stdout: String(stdout), stderr: String(stderr) };
    } catch (err: any) {
        return { stdout: err.stdout ?? '', stderr: err.stderr ?? (err.message ?? String(err)) };
    }
}

// Re-export context-gathering utilities so callers only need to import from tools
export { searchCode, traceImports, getFileTree } from '../core/context';
export type { SearchResult, SearchOptions, ContextFile } from '../core/types';
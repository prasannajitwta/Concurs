import * as fs from 'fs';
import * as path from 'path';
import {
    ContextFile,
    SearchResult,
    SearchOptions,
    SmartContextOptions,
    SmartContextResult,
    SmartContextChunk,
    ContextMode,
} from './types';

// TODO: For semantic search beyond grep, integrate @xenova/transformers or sentence-transformers

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'out', 'dist', '__pycache__',
    '.venv', 'build', 'coverage', '.next', '.nuxt',
]);

const BINARY_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.eot', '.ttf', '.otf', '.pdf',
    '.zip', '.tar', '.gz', '.exe', '.dll', '.so',
    '.min.js', '.map',
]);

const CODE_EXTS = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
    '.json', '.md', '.py', '.java', '.go', '.rs', '.cs', '.cpp', '.c', '.h', '.hpp', '.php', '.rb', '.swift', '.kt',
];

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'in', 'on', 'at', 'to', 'for',
    'of', 'and', 'or', 'not', 'this', 'that', 'it', 'fix', 'bug', 'add',
    'change', 'update', 'how', 'what', 'where', 'why', 'can', 'you',
    'please', 'help', 'me', 'with', 'file', 'code', 'function', 'check',
]);

// ─── File Tree ────────────────────────────────────────────────────────────────

export function getFileTree(rootPath: string, maxDepth = 4): string {
    const lines: string[] = [path.basename(rootPath) + '/'];

    function walk(dir: string, prefix: string, depth: number): void {
        if (depth > maxDepth) { return; }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        // Filter out hidden files and skip dirs
        entries = entries.filter(e => !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'));

        // Directories first, then files; alphabetically within each group
        entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) { return -1; }
            if (!a.isDirectory() && b.isDirectory()) { return 1; }
            return a.name.localeCompare(b.name);
        });

        entries.forEach((entry, idx) => {
            const isLast = idx === entries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const childPrefix = isLast ? '    ' : '│   ';
            lines.push(prefix + connector + entry.name + (entry.isDirectory() ? '/' : ''));
            if (entry.isDirectory()) {
                walk(path.join(dir, entry.name), prefix + childPrefix, depth + 1);
            }
        });
    }

    walk(rootPath, '', 1);
    return lines.join('\n');
}

// ─── Import Tracing ───────────────────────────────────────────────────────────

const IMPORT_PATTERNS: RegExp[] = [
    /from\s+['"](\.[^'"]+)['"]/g,         // ES6: from './path'
    /require\s*\(\s*['"](\.[^'"]+)['"]/g,  // CJS: require('./path')
    /import\s+['"](\.[^'"]+)['"]/g,        // side-effect: import './path'
];

const RESOLVABLE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.mts', '.cts'];

function resolveImportPath(importPath: string, fromFile: string): string | null {
    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, importPath);

    // Exact match (e.g. already has extension)
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
    }

    // Try appending each known extension
    for (const ext of RESOLVABLE_EXTS) {
        const withExt = resolved + ext;
        if (fs.existsSync(withExt)) { return withExt; }
    }

    // Try as a directory index file
    for (const ext of RESOLVABLE_EXTS) {
        const indexFile = path.join(resolved, 'index' + ext);
        if (fs.existsSync(indexFile)) { return indexFile; }
    }

    return null;
}

export function traceImports(entryFile: string, _rootPath: string, maxDepth = 2): ContextFile[] {
    const visited = new Set<string>();
    const result: ContextFile[] = [];

    function trace(filePath: string, depth: number): void {
        if (depth > maxDepth) { return; }
        if (visited.has(filePath)) { return; }
        visited.add(filePath);

        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch {
            return;
        }

        result.push({ path: filePath, content });

        for (const pattern of IMPORT_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(content)) !== null) {
                const resolved = resolveImportPath(match[1], filePath);
                if (resolved) {
                    trace(resolved, depth + 1);
                }
            }
        }
    }

    trace(entryFile, 0);
    return result;
}

// ─── Code Search (grep) ───────────────────────────────────────────────────────

export function searchCode(query: string, rootPath: string, options: SearchOptions = {}): SearchResult[] {
    const {
        isRegex = false,
        maxResults = 100,
        includeExtensions,
        excludeDirs,
    } = options;

    const excludeSet = new Set([...SKIP_DIRS, ...(excludeDirs ?? [])]);
    const results: SearchResult[] = [];

    let pattern: RegExp;
    try {
        pattern = isRegex
            ? new RegExp(query, 'i')
            : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch {
        return results;
    }

    function walk(dir: string): void {
        if (results.length >= maxResults) { return; }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= maxResults) { return; }
            if (entry.name.startsWith('.') || excludeSet.has(entry.name)) { continue; }

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (BINARY_EXTS.has(ext)) { continue; }
                if (includeExtensions && !includeExtensions.includes(ext)) { continue; }

                let content: string;
                try {
                    content = fs.readFileSync(fullPath, 'utf8');
                } catch {
                    continue;
                }

                const lines = content.split('\n');
                lines.forEach((line, idx) => {
                    if (results.length < maxResults && pattern.test(line)) {
                        results.push({
                            filePath: path.relative(rootPath, fullPath),
                            lineNumber: idx + 1,
                            line: line.trim(),
                        });
                    }
                });
            }
        }
    }

    walk(rootPath);
    return results;
}

// ─── Smart Context Assembly ──────────────────────────────────────────────────

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function isBroadQuery(query: string): boolean {
    const lower = query.toLowerCase();
    const broadHints = [
        'overview', 'architecture', 'system design', 'how this project works',
        'explain codebase', 'walkthrough', 'end to end', 'entire', 'whole project',
    ];
    if (broadHints.some(h => lower.includes(h))) {
        return true;
    }
    return query.split(/\s+/).length > 30;
}

export function extractKeywords(query: string): string[] {
    const raw = query
        .split(/[\s,.()?!:;{}\[\]<>\"'`]+/)
        .map(word => word.trim())
        .filter(Boolean);

    const keywords = raw
        .filter(word => word.length > 2)
        .filter(word => !STOP_WORDS.has(word.toLowerCase()));

    return Array.from(new Set(keywords)).slice(0, 6);
}

function safeReadFile(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function toDisplayPath(filePath: string, rootPath?: string): string {
    if (!rootPath) {
        return filePath;
    }
    if (!path.isAbsolute(filePath)) {
        return filePath;
    }
    const rel = path.relative(rootPath, filePath);
    return rel.startsWith('..') ? filePath : rel;
}

function extractImportPaths(content: string, filePath: string): string[] {
    const dir = path.dirname(filePath);
    const imports: string[] = [];
    for (const pattern of IMPORT_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            const resolved = resolveImportPath(match[1], filePath);
            if (resolved) {
                imports.push(resolved);
            }
        }
    }
    // Preserve dir relationship just in case resolve fails for future extension.
    if (imports.length === 0) {
        const sideEffect = [...content.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(m => m[1]);
        for (const imp of sideEffect) {
            imports.push(path.resolve(dir, imp));
        }
    }
    return Array.from(new Set(imports));
}

export function extractSurroundingSymbol(fileContent: string, matchLine: number): string {
    const lines = fileContent.split('\n');
    if (lines.length === 0) {
        return '';
    }

    let start = Math.max(0, matchLine - 1);
    while (start > 0) {
        const line = lines[start];
        if (line.match(/^(export\s+)?(async\s+)?(function|class|interface|type)\s+/)) {
            break;
        }
        if (line.match(/^\s*(public|private|protected)?\s*(async\s+)?(static\s+)?[A-Za-z_$][\w$]*\s*\(/) && start < matchLine - 1) {
            break;
        }
        if (line.match(/^\s*const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?\(/)) {
            break;
        }
        start--;
    }

    let end = Math.max(start, matchLine - 1);
    let braceCount = 0;
    let opened = false;
    while (end < lines.length) {
        const line = lines[end];
        for (const c of line) {
            if (c === '{') {
                braceCount++;
                opened = true;
            }
            if (c === '}') {
                braceCount--;
            }
        }
        end++;
        if (opened && braceCount <= 0) {
            break;
        }
        // Safety stop for malformed code blocks.
        if (end - start > 220) {
            break;
        }
    }

    start = Math.max(0, start - 2);
    end = Math.min(lines.length, end + 2);
    return lines.slice(start, end).join('\n');
}

function addChunkWithBudget(
    chunks: SmartContextChunk[],
    dedupe: Set<string>,
    chunk: SmartContextChunk,
    tokenBudgetRef: { value: number },
    maxChunks: number,
): void {
    if (chunks.length >= maxChunks) {
        return;
    }
    const normalized = `${chunk.file}\n${chunk.content}`;
    if (dedupe.has(normalized)) {
        return;
    }
    const chunkTokens = estimateTokens(chunk.content);
    if (chunkTokens > tokenBudgetRef.value) {
        return;
    }
    dedupe.add(normalized);
    chunks.push(chunk);
    tokenBudgetRef.value -= chunkTokens;
}

function includeKeywordMatchedChunks(
    sourceContent: string,
    sourcePath: string,
    keywords: string[],
    relevancePrefix: string,
    chunks: SmartContextChunk[],
    dedupe: Set<string>,
    tokenBudgetRef: { value: number },
    maxChunks: number,
): void {
    const lines = sourceContent.split('\n');
    for (const keyword of keywords) {
        const lineIndex = lines.findIndex(l => l.toLowerCase().includes(keyword.toLowerCase()));
        if (lineIndex < 0) {
            continue;
        }
        const extracted = extractSurroundingSymbol(sourceContent, lineIndex + 1);
        if (!extracted.trim()) {
            continue;
        }
        addChunkWithBudget(
            chunks,
            dedupe,
            {
                file: sourcePath,
                content: extracted,
                relevance: `${relevancePrefix}: contains "${keyword}"`,
            },
            tokenBudgetRef,
            maxChunks,
        );
    }
}

export function gatherSmartContext(params: {
    rootPath?: string;
    userQuery: string;
    uploadedFiles?: Map<string, string>;
    currentFilePath?: string;
    options?: SmartContextOptions;
}): SmartContextResult {
    const {
        rootPath,
        userQuery,
        uploadedFiles,
        currentFilePath,
        options,
    } = params;

    const mode: ContextMode = options?.mode ?? 'hybrid';
    const maxChunks = options?.maxChunks ?? 14;
    const tokenBudgetRef = { value: options?.tokenBudget ?? 28000 };

    const keywords = extractKeywords(userQuery);
    const chunks: SmartContextChunk[] = [];
    const dedupe = new Set<string>();

    const broad = isBroadQuery(userQuery);
    const includeFileTree = options?.includeFileTree ?? broad;

    if (includeFileTree && rootPath) {
        try {
            const tree = getFileTree(rootPath, 3);
            const treeTokens = estimateTokens(tree);
            if (treeTokens <= tokenBudgetRef.value) {
                chunks.push({
                    file: 'PROJECT_STRUCTURE',
                    content: tree,
                    relevance: 'Project overview',
                });
                tokenBudgetRef.value -= treeTokens;
            }
        } catch {
            // Non-fatal
        }
    }

    // Current file: include only matched chunks by policy.
    if (currentFilePath && mode !== 'manual') {
        const currentContent = safeReadFile(currentFilePath);
        if (currentContent) {
            const display = toDisplayPath(currentFilePath, rootPath);
            includeKeywordMatchedChunks(
                currentContent,
                display,
                keywords.length > 0 ? keywords : ['function', 'class'],
                'Current file',
                chunks,
                dedupe,
                tokenBudgetRef,
                maxChunks,
            );

            const imports = extractImportPaths(currentContent, currentFilePath).slice(0, 4);
            for (const imp of imports) {
                if (tokenBudgetRef.value < 1200 || chunks.length >= maxChunks) {
                    break;
                }
                const impContent = safeReadFile(imp);
                if (!impContent) {
                    continue;
                }
                includeKeywordMatchedChunks(
                    impContent,
                    toDisplayPath(imp, rootPath),
                    keywords,
                    'Imported by current file',
                    chunks,
                    dedupe,
                    tokenBudgetRef,
                    maxChunks,
                );
            }
        }
    }

    // Uploaded files are first-class signals in manual/hybrid modes.
    if ((mode === 'manual' || mode === 'hybrid') && uploadedFiles && uploadedFiles.size > 0) {
        for (const [filePath, content] of uploadedFiles.entries()) {
            if (tokenBudgetRef.value < 1000 || chunks.length >= maxChunks) {
                break;
            }

            const display = toDisplayPath(filePath, rootPath);
            if (keywords.length === 0) {
                // If no clear keywords, include a compact leading chunk.
                const head = content.split('\n').slice(0, 80).join('\n');
                addChunkWithBudget(
                    chunks,
                    dedupe,
                    {
                        file: display,
                        content: head,
                        relevance: 'User-selected context',
                    },
                    tokenBudgetRef,
                    maxChunks,
                );
                continue;
            }

            includeKeywordMatchedChunks(
                content,
                display,
                keywords,
                'User-selected file',
                chunks,
                dedupe,
                tokenBudgetRef,
                maxChunks,
            );
        }
    }

    // Smart grep-backed retrieval from workspace.
    if (mode !== 'manual' && rootPath && keywords.length > 0) {
        for (const keyword of keywords) {
            if (tokenBudgetRef.value < 1200 || chunks.length >= maxChunks) {
                break;
            }
            const matches = searchCode(keyword, rootPath, {
                maxResults: 12,
                includeExtensions: CODE_EXTS,
            });

            for (const match of matches.slice(0, 4)) {
                if (tokenBudgetRef.value < 1200 || chunks.length >= maxChunks) {
                    break;
                }

                const absolute = path.join(rootPath, match.filePath);
                const content = safeReadFile(absolute);
                if (!content) {
                    continue;
                }

                const extracted = extractSurroundingSymbol(content, match.lineNumber);
                addChunkWithBudget(
                    chunks,
                    dedupe,
                    {
                        file: match.filePath,
                        content: extracted,
                        relevance: `Search match for "${keyword}"`,
                    },
                    tokenBudgetRef,
                    maxChunks,
                );
            }
        }
    }

    const formattedContext = chunks.map(c =>
        `## ${c.file} (${c.relevance})\n\`\`\`\n${c.content}\n\`\`\``,
    ).join('\n\n');

    const uniqueFiles = new Set(chunks.map(c => c.file));
    const usedTokens = (options?.tokenBudget ?? 28000) - tokenBudgetRef.value;

    return {
        formattedContext,
        chunks,
        metadata: {
            mode,
            includedFileTree: includeFileTree,
            uploadedFiles: uploadedFiles?.size ?? 0,
            matchedFiles: uniqueFiles.size,
            chunks: chunks.length,
            estimatedTokens: Math.max(0, usedTokens),
        },
    };
}

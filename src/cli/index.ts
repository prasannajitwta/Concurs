#!/usr/bin/env node
/**
 * Concur CLI Agent — readline REPL using the same CoreAgent brain as the VS Code extension.
 *
 * Usage:
 *   AZURE_OPENAI_ENDPOINT=<url> \
 *   AZURE_OPENAI_DEPLOYMENT=<model> \
 *   AZURE_OPENAI_API_KEY=<key> \
 *   node out/cli/index.js [workspace-root]
 *
 * Commands:
 *   /tree              — print the project file tree
 *   /search <query>    — grep search across workspace
 *   /add <path>        — add a file to LLM context
 *   /trace <path>      — trace file imports and add them to context
 *   /files             — list files currently in context
 *   /clear             — clear all context files
 *   /help              — show this help
 *   /exit              — quit
 *   <anything else>    — send as a chat message to the LLM
 */

import * as readline from 'readline';
import * as path from 'path';
import { CliAgent } from './cliAgent';
import { getFileTree, searchCode } from '../core/context';

const rootPath = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

let agent: CliAgent;
try {
    agent = new CliAgent(rootPath);
} catch (err) {
    process.stderr.write(`[Error] ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write('Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, and AZURE_OPENAI_API_KEY environment variables.\n');
    process.exit(1);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nYou> ',
});

process.stdout.write(`\n═══════════════════════════════════════\n`);
process.stdout.write(` Concur CLI Agent\n`);
process.stdout.write(` Workspace: ${rootPath}\n`);
process.stdout.write(` Type /help for commands\n`);
process.stdout.write(`═══════════════════════════════════════\n`);

rl.prompt();

rl.on('line', async (line: string) => {
    const input = line.trim();
    if (!input) {
        rl.prompt();
        return;
    }

    if (input === '/exit' || input === '/quit') {
        process.stdout.write('Goodbye!\n');
        rl.close();
        process.exit(0);
    }

    if (input === '/help') {
        process.stdout.write(`
Commands:
  /tree              Print the project file tree
  /search <query>    Grep search across workspace
  /add <path>        Add a file to LLM context
  /trace <path>      Trace file imports and add them to context
  /files             List files currently in context
  /clear             Clear all context files
  /exit              Quit
  <message>          Send a chat message to the LLM
`);
        rl.prompt();
        return;
    }

    if (input === '/tree') {
        try {
            const tree = getFileTree(rootPath);
            process.stdout.write('\n' + tree + '\n');
        } catch (err) {
            process.stderr.write(`[Error] Could not generate tree: ${err}\n`);
        }
        rl.prompt();
        return;
    }

    if (input.startsWith('/search ')) {
        const query = input.slice('/search '.length).trim();
        if (!query) {
            process.stdout.write('Usage: /search <query>\n');
            rl.prompt();
            return;
        }
        const results = searchCode(query, rootPath, { maxResults: 50 });
        if (results.length === 0) {
            process.stdout.write('  (no matches)\n');
        } else {
            results.forEach(r => {
                process.stdout.write(`  ${r.filePath}:${r.lineNumber}  ${r.line}\n`);
            });
            process.stdout.write(`\n  ${results.length} result(s)\n`);
        }
        rl.prompt();
        return;
    }

    if (input.startsWith('/add ')) {
        const filePath = input.slice('/add '.length).trim();
        agent.addFile(filePath);
        rl.prompt();
        return;
    }

    if (input.startsWith('/trace ')) {
        const filePath = input.slice('/trace '.length).trim();
        agent.traceAndAddImports(filePath, rootPath);
        rl.prompt();
        return;
    }

    if (input === '/files') {
        agent.listContextFiles();
        rl.prompt();
        return;
    }

    if (input === '/clear') {
        agent.clearContext();
        rl.prompt();
        return;
    }

    // Regular chat message
    await agent.handleMessage(input);
    rl.prompt();
});

rl.on('close', () => {
    process.exit(0);
});

# Concur - LLM Context Loading Guide

## 📊 How Data Flows to the LLM

This guide explains exactly what data is sent to Azure OpenAI and how it's structured.

---

## 🔄 Current Architecture (Opt-In Context)

Your system uses **explicit context injection** - you control what gets sent to the LLM:

```
User Uploads Files
   ↓
Store in Memory (fileStore)
   ↓
User Asks Question
   ↓
Include ONLY Uploaded Files in Prompt
   ↓
Send to Azure OpenAI (Full Prompt)
   ↓
LLM Processes & Returns Response
   ↓
Parse File Edits
   ↓
Apply Changes
```

**Key Point:** ✅ **Opt-in context only** - Nothing sent unless you explicitly upload it. No automatic workspace scanning or active file injection.

---

## 📝 What Gets Sent to LLM

### 1. System Prompt (Instructions)
```typescript
// FIXED - Always sent
- Instructions for code formatting
- Rules for markdown
- File editing syntax (===FILE:...|EDIT===)
- Output expectations
```

### 2. User Prompt (Context + Request)
```typescript
${uploadedFilesContext}           // User-uploaded files (5000 chars each max)
## WORKSPACE CONTEXT:
${context}                        // Workspace info + active file
## USER REQUEST:
${userMessage}                    // What user is asking
```

---

## 🗂️ Data Gathering Process

### Step 1: Get Workspace Files List
```typescript
const files = await tools.listFiles(workspaceRoot);
// Returns: string[] of all file paths
// Default limit: 2000 files
// Max shown to LLM: 50 files
```
**Cost:** Just file names, no content

### <del>2. Get Active File</del>
~~REMOVED - No longer automatic~~

### 2: Get Uploaded Files (User explicit)
```typescript
Array.from(this.fileStore.entries()).forEach(([path, content]) => {
  uploadedFilesContext += `\n### File: ${fileName}\n\`\`\`\n${content.slice(0, 5000)}\n\`\`\`\n`;
});
// Returns: User-selected files, capped at 5000 chars each
```
**Cost:** 5KB per uploaded file

---

## 💾 Memory Structure

All files stored in-memory map:

```typescript
private fileStore: Map<string, string> = new Map();
// Key: Full file path
// Value: Full file content

// Operations:
this.fileStore.set(filePath, content);        // Add/upload
Array.from(this.fileStore.entries());         // Read all
this.fileStore.clear();                       // Clear context
```

**RAM Usage Example:**
- 10 files × 50KB average = ~500KB in memory
- 100 files × 50KB average = ~5MB in memory

---

## 📤 LLM Request Structure

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a VS Code assistant...\n(2000 tokens)"
    },
    {
      "role": "user",
      "content": "## UPLOADED CONTEXT FILES:\n### File: helpers.ts\n```\n[5000 chars of uploaded file]...\n```\n\n## USER REQUEST:\nFix the bug in utils.ts\n(500-5000 tokens)"
    }
  ],
  "model": "gpt-5",
  "max_completion_tokens": 4000
}
```

**Total Tokens Per Request:** ~2500-7000 tokens (much lower!)
- System prompt: ~2000 tokens
- Context data: ~0-3000 tokens (ONLY uploaded files)
- Response: ~500-2000 tokens

---

## 🔍 What's Included vs. Excluded

### ✅ INCLUDED in LLM Context
- **ONLY** uploaded file contents (full code)
- User's specific request

### ❌ NOT INCLUDED (Automatic)
- Workspace files (won't scan automatically)
- Active editor file (NOT auto-included)
- node_modules
- Files in .gitignore  
- Configuration files
- Workspace root path
- List of files
- Search history

### ⚠️ LIMITATIONS
- Max 5000 chars per uploaded file
- Max 50 workspace files listed
- Max 10KB of active file shown
- No semantic search or ranking
- No previous conversation history
- Everything sent fresh each request

---

## 💡 Examples - What LLM Sees

### Example 1: Minimal Request
```
User uploads: main.ts (2KB)

LLM receives:
- System prompt (~2000 tokens)
- main.ts (full, ~500 tokens)
- User request (~200 tokens)
Total: ~2700 tokens
Cost: ~$0.04
```

### Example 2: Heavy Request
```
User uploads: 5 files (50KB total)

LLM receives:
- System prompt (~2000 tokens)
- 5 files (each capped 5KB, ~3000 tokens)
- User request (~500 tokens)
Total: ~5500 tokens
Cost: ~$0.08
```

---

## 🚀 Optimization: Embedding vs. Current Approach

### Current System (Direct Injection)
```
✅ Pros:
- No setup needed
- Works immediately
- Full context always available
- Accurate line numbers preserved
- Real file content

❌ Cons:
- Token cost increases with file size
- Not scalable for large projects
- No intelligent ranking
- Everything sent each request
```

### With RAG/Embeddings (Optional)
```
✅ Pros:
- Lower token cost
- Scalable to huge codebases
- Semantic search
- Intelligent file ranking
- Reusable embeddings

❌ Cons:
- Requires vector DB (Pinecone, Weaviate, etc.)
- Setup complexity
- Staleness issues if code changes
- Potential loss of context
```

---

## 📊 Token Cost Analysis

### Request Pricing (Azure GPT-5)
- Input: $0.003 per 1K tokens
- Output: $0.012 per 1K tokens

### Cost Examples (After Optimization)
```
Minimal request (2700 tokens):
Input:  2.7 × $0.003/1K = $0.008
Output: 1.5 × $0.012/1K = $0.018
Total: ~$0.03 per request (50% savings!)

Heavy request (5500 tokens):
Input:  5.5 × $0.003/1K = $0.017
Output: 2 × $0.012/1K = $0.024
Total: ~$0.04 per request (50% savings!)
```

---

## 🔧 How to Optimize (Optional)

### Option 1: Smarter File Selection
```typescript
// Only send relevant files
const uploadedFilesContext = Array.from(this.fileStore.entries())
  .filter(([path]) => {
    // Only include files related to user's request
    return userMessage.toLowerCase().includes(
      path.split('/').pop() || ''
    );
  })
  .map(([path, content]) => ...)
  .join('\n');
```

### Option 2: Chunk Large Files
```typescript
// Break big files into smaller chunks
if (content.length > 5000) {
  const chunkSize = 2000;
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize));
  }
}
```

### Option 3: Add Embeddings (Advanced)
```typescript
// Use Pinecone or Weaviate for semantic search
import { Pinecone } from '@pinecone-database/pinecone';

// 1. Embed files on upload
const embeddings = await embedText(fileContent);
await pinecone.upsert([{ id, values: embeddings, metadata: { path } }]);

// 2. Search on request
const results = await pinecone.query(userMessage, { topK: 5 });
// Returns 5 most relevant files only
```

---

## ✅ Current System - Complete Picture (Opt-In)

```
┌─────────────────────────────────────────────────────────┐
│ VS Code Extension (Frontend)                             │
│                                                          │
│ User Explicitly Clicks:                                 │
│ - "📄 Add Active File" → upload editor content         │
│ - "📁 Add Workspace" → upload first 200 files          │
│                                                          │
│ Files Stored in: Map<path, content>                    │
│ Shown in UI: Context Files panel with counts           │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────▼────────┐
        │ User Types Query │
        └────────┬────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│ Backend Process (Node.js)                               │
│                                                          │
│ 1. Get ONLY Uploaded Files:                             │
│    - read fileStore.entries() → only user-uploaded     │
│    - Cap each file: 5KB max                             │
│    - NO automatic workspace scanning                    │
│    - NO active file injection                           │
│                                                          │
│ 2. Build Context:                                       │
│    - System prompt (fixed instructions)                │
│    - User prompt (ONLY uploaded files + request)       │
│                                                          │
│ 3. Build API Request:                                   │
│    - messages: [system, user]                          │
│    - model: gpt-5                                      │
│    - max_tokens: 4000                                  │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────▼────────────────────┐
        │ Azure OpenAI API            │
        │ (Process LLM Response)      │
        └────────┬────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│ Response Parsing & Execution                             │
│                                                          │
│ Find: ===FILE: path|EDIT===                            │
│ Find: ===FILE: path|CREATE===                          │
│                                                          │
│ Execute:                                                │
│ - vscode.workspace.fs.writeFile()  → Edit/Create       │
│ - vscode.window.showTextDocument() → Open in Editor    │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────▼──────────────────┐
        │ Files Updated!            │
        │ Changes Visible in Editor │
        └───────────────────────────┘
```

---

## 🎯 Summary

### What We're Doing
- ✅ **Direct Context Injection** - Send all relevant code in prompt
- ✅ **In-Memory Storage** - Keep files in RAM
- ✅ **Full Content** - No compression or sampling
- ✅ **Smart Capping** - Limit per-file to avoid token waste

### What We're NOT Doing
- ❌ Automatic workspace scanning
- ❌ Embedding/Vectorization  
- ❌ Semantic Search
- ❌ RAG (Retrieval Augmented Generation)
- ❌ Conversation History
- ❌ Caching

### Best For
- Any size project (no automatic bloat)
- Focused questions with relevant files
- Fine-grained control over context
- Cost efficiency (only pay for what you need)
- Real-time code changes

### Future Enhancements
- Smart file suggestions based on question
- Conversation history (remember previous context)
- File similarity matching
- Integration with embeddings if needed

---

## 🔗 Related Files

- [src/agent/orchestrator.ts](src/agent/orchestrator.ts) - Context building
- [src/agent/tools.ts](src/agent/tools.ts) - File listing & reading
- [src/extension.ts](src/extension.ts) - File upload handling
- [src/resources/webview.js](src/resources/webview.js) - Frontend file management

---

**TL;DR:** Only files YOU explicitly upload go to LLM as raw text. No automatic scanning, no hidden context, full control. Simple, efficient, and cost-effective. 🚀

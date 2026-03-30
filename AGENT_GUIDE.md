# Concur AI Agent - File Editing Guide

## 🎯 What's New

Your VS Code extension now works like **Cursor** with automatic file editing capabilities:

### Features
✅ **File Context Display** - See all files in context  
✅ **Auto File Editing** - LLM can modify existing files  
✅ **Auto File Creation** - LLM can create new files  
✅ **Code Block Rendering** - Proper markdown with language highlighting  
✅ **File Opening** - Modified files auto-open in editor  

---

## 🚀 How to Use

### 1. Add Files to Context
```
1. Click "📄 Add Active File" to include current editor file
2. Click "📁 Add Workspace" to load first 200 workspace files
3. Files appear in the "Context Files" section at top of chat
```

### 2. Request Code Changes
```
Chat: "Fix the bug in utils.ts"
Chat: "Add TypeScript types to functions"
Chat: "Create a new component for login"
```

### 3. Automatic Edits Apply
- AI responds with your request
- File edits are automatically detected and applied
- Modified files open in VS Code editor
- You see the changes immediately

---

## 📝 File Edit Format (For LLM)

The AI knows to format file edits like this in responses:

### Edit Existing File
```
===FILE: src/utils/helpers.ts|EDIT===
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US');
}

export function parseDate(str: string): Date | null {
  return new Date(str);
}
```

### Create New File
```
===FILE: src/components/LoginForm.tsx|CREATE===
import React from 'react';

export const LoginForm = () => {
  return <form>{/* form content */}</form>;
};
```

---

## 🔄 File Editing Workflow

```
1. User Uploads Files
   ↓
2. System Stores Files in Context
   ↓
3. User Asks AI for Changes
   ↓
4. LLM Responds with Explanation + File Blocks
   ↓
5. Frontend Parses `===FILE:...===` Blocks
   ↓
6. Backend Applies Edits (EDIT/CREATE)
   ↓
7. Modified Files Open in Editor
   ↓
8. Ready for Review or Further Changes
```

---

## 🛠 Technical Details

### Key Components

| File | Purpose |
|------|---------|
| `src/extension.ts` | Backend file handlers (save/read/edit) |
| `src/resources/webview.js` | Frontend parsing & execution |
| `src/agent/orchestrator.ts` | LLM prompt with file edit instructions |

### Message Types

```javascript
// Frontend → Backend
{ type: 'executeEdit', filePath: string, content: string, isNew: boolean }
{ type: 'readFile', filePath: string }

// Backend → Frontend
{ type: 'editResult', success: boolean, message: string, error?: string }
{ type: 'fileContent', content: string, error?: string }
{ type: 'messageResponse', response: string }
```

---

## 💡 Example Interaction

**User:** 
```
Upload workspace files and fix the TODO in extension.ts
```

**AI Response:**
```
Found the TODO in your extension.ts. Here's the fix:

===FILE: src/extension.ts|EDIT===
import * as vscode from 'vscode';
import { ConfigManager } from './config/configManager';

export function activate(context: vscode.ExtensionContext) {
  console.log("Concur extension activated ✅");
  vscode.window.showInformationMessage("Concur is ready!");
  
  const configManager = new ConfigManager(context);
  // ... rest of the code
===FILE: src/utils/newHelper.ts|CREATE===
export function helperFunction() {
  return "Helper implementation";
}
```

**Result:**
- ✅ `src/extension.ts` updated with your changes
- ✅ `src/utils/newHelper.ts` created
- ✅ Both files open in editor for review

---

## ⚙️ Configuration

Uses Azure OpenAI with these settings:
- Endpoint: Your Azure OpenAI endpoint
- Deployment: GPT model (5.2, 4, etc.)
- API Version: Latest supported
- Max Tokens: 4000 per response

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| File not editing | Ensure AI response includes `===FILE:...|EDIT===` |
| New file not created | Verify `===FILE:...|CREATE===` format |
| Format errors | Check that full file content is in blocks |
| Files not opening | Check VS Code notifications for errors |

---

## 📦 System Requirements

- VS Code 1.50+
- Node.js 14+
- TypeScript 4.0+
- Azure OpenAI credentials

---

Start using your coding agent now! Upload files, describe changes, and watch them happen automatically. 🎉

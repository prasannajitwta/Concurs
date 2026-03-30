const vscode = acquireVsCodeApi();
let contextFiles = new Set(); // Store files in current context

function switchTab(tab) {
    const chatSection = document.getElementById('chatSection');
    const planningSection = document.getElementById('planningSection');
    const chatTab = document.getElementById('chatTab');
    const planningTab = document.getElementById('planningTab');
    
    if (tab === 'chat') {
        chatSection.style.display = 'flex';
        planningSection.style.display = 'none';
        chatTab.style.background = 'var(--vscode-button-background)';
        chatTab.style.color = 'var(--vscode-button-foreground)';
        chatTab.style.borderBottom = '2px solid var(--vscode-editorLink-activeForeground)';
        planningTab.style.background = 'transparent';
        planningTab.style.color = 'var(--vscode-descriptionForeground)';
        planningTab.style.borderBottom = '2px solid transparent';
    } else if (tab === 'planning') {
        chatSection.style.display = 'none';
        planningSection.style.display = 'flex';
        chatTab.style.background = 'transparent';
        chatTab.style.color = 'var(--vscode-descriptionForeground)';
        chatTab.style.borderBottom = '2px solid transparent';
        planningTab.style.background = 'var(--vscode-button-background)';
        planningTab.style.color = 'var(--vscode-button-foreground)';
        planningTab.style.borderBottom = '2px solid var(--vscode-editorLink-activeForeground)';
    }
}

function newChat() {
    // Clear messages
    document.getElementById('messages').innerHTML = '';
    
    // Clear context
    clearContext();
    
    // Switch to chat tab
    switchTab('chat');
    
    // Focus on input
    document.getElementById('messageInput').focus();
}

function addModel() {
    const setup = document.getElementById('setup');
    const chat = document.getElementById('chat');

    setup.style.display = 'flex';
    chat.style.display = 'none';
}

function save() {
    const data = {
        endpoint: document.getElementById('endpoint').value,
        deployment: document.getElementById('deployment').value,
        apiVersion: document.getElementById('version').value,
        apiKey: document.getElementById('key').value
    };

    vscode.postMessage({ type: 'saveConfig', data });
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();

    if (!text) return;

    // Add user message to display
    addMessageToChat('user', text);
    input.value = '';
    input.focus();

    // Show loading and send to backend
    document.getElementById('loading').style.display = 'block';
    vscode.postMessage({ type: 'sendMessage', text });
}

function uploadFiles(scope) {
    const out = document.getElementById('toolOutput');
    if (out) out.textContent = 'Uploading and adding to context...';
    vscode.postMessage({ type: 'uploadFiles', filePaths: [] });
}

function selectFiles() {
    vscode.postMessage({ type: 'selectFiles' });
}

function clearContext() {
    contextFiles.clear();
    updateContextDisplay();
    vscode.postMessage({ type: 'clearContext' });
}

function updateContextDisplay() {
    const contextContainer = document.getElementById('contextFiles');
    if (!contextContainer) return;
    
    if (contextFiles.size === 0) {
        contextContainer.innerHTML = '<div class="empty-context">No files in context. Upload files to add them.</div>';
        return;
    }
    
    let html = '<div class="context-label">📎 Context Files (' + contextFiles.size + '):</div>';
    contextFiles.forEach(file => {
        const fileName = file.split('/').pop();
        html += `<div class="context-file" title="${file}">${fileName} <span class="remove-file" onclick="removeFromContext('${file}')">✕</span></div>`;
    });
    contextContainer.innerHTML = html;
}

function removeFromContext(filePath) {
    contextFiles.delete(filePath);
    updateContextDisplay();
    vscode.postMessage({ type: 'removeFile', filePath });
}

function addFilesToContext(files) {
    if (Array.isArray(files)) {
        files.forEach(f => contextFiles.add(typeof f === 'string' ? f : f.path));
    } else {
        contextFiles.add(files.path || files);
    }
    updateContextDisplay();
}

function addMessageToChat(sender, text) {
    const messagesDiv = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message ' + sender;
    
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    
    if (sender === 'ai') {
        // Parse and render markdown/code blocks
        contentEl.innerHTML = renderMarkdown(text);
    } else {
        contentEl.textContent = text;
    }
    
    messageEl.appendChild(contentEl);
    messagesDiv.appendChild(messageEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function renderMarkdown(text) {
    // Escape HTML first
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Convert headings (##, ###, ####)
    html = html.replace(/^### (.*?)$/gm, '<h3 class="markdown-h3">$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2 class="markdown-h2">$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1 class="markdown-h1">$1</h1>');
    
    // Convert code blocks (```language...```)
    html = html.replace(/```([^\n]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang.trim() || 'plaintext';
        const escapedCode = code.trim();
        return `<div class="code-block"><div class="code-lang">${language}</div><pre><code>${escapedCode}</code></pre></div>`;
    });
    
    // Convert inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    
    // Convert bold (**text**)
    html = html.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
    
    // Convert italic (*text*)
    html = html.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
    
    // Convert line breaks
    html = html.replace(/\n/g, '<br>');
    
    // Convert lists (starts with -)
    html = html.replace(/^- (.*?)(?=<br>|$)/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>(?:<br>)*)+/gs, '<ul>$&</ul>');
    
    return html;
}

// Parse file edits from LLM response (format: ===FILE: path|MODE===)
function parseFileEdits(response) {
    const edits = [];
    const fileBlockRegex = /===FILE:\s*(.+?)\s*\|\s*(CREATE|EDIT)\s*===\n([\s\S]*?)(?===FILE:|$)/g;
    let match;
    
    while ((match = fileBlockRegex.exec(response)) !== null) {
        edits.push({
            filePath: match[1].trim(),
            mode: match[2],
            content: match[3].trim()
        });
    }
    return edits;
}

// Execute file edit by sending to backend
function executeFileEdit(edit) {
    vscode.postMessage({
        type: 'executeEdit',
        filePath: edit.filePath,
        content: edit.content,
        isNew: edit.mode === 'CREATE'
    });
}

// Read file for preview
function readFileContent(filePath) {
    vscode.postMessage({
        type: 'readFile',
        filePath: filePath
    });
}

function invokeTool(tool) {
    vscode.postMessage({ type: 'invokeTool', tool });
}

function traceActiveImports() {
    const out = document.getElementById('toolOutput');
    const bar = document.getElementById('toolOutputBar');
    if (out && bar) {
        out.textContent = 'Tracing imports from active file...';
        bar.style.display = 'block';
    }
    vscode.postMessage({ type: 'traceImports' });
}

function invokeSearch() {
    const input = document.getElementById('searchInput');
    const query = input ? input.value.trim() : '';
    if (!query) { return; }
    const out = document.getElementById('toolOutput');
    const bar = document.getElementById('toolOutputBar');
    if (out && bar) {
        out.textContent = `Searching for "${query}"...`;
        bar.style.display = 'block';
    }
    vscode.postMessage({ type: 'invokeTool', tool: 'searchCode', query });
}

function generatePlan() {
    const planInput = document.getElementById('planInput');
    const request = planInput.value.trim();
    
    if (!request) {
        alert('Please enter a development task description');
        return;
    }
    
    document.getElementById('planLoading').style.display = 'block';
    document.getElementById('approaches').innerHTML = '';
    vscode.postMessage({ type: 'generatePlan', request });
}

function selectApproach(approach) {
    const planLoading = document.getElementById('planLoading');
    planLoading.style.display = 'block';
    planLoading.textContent = 'Generating detailed plan...';
    
    const planInput = document.getElementById('planInput');
    const userRequest = planInput.value.trim();
    
    vscode.postMessage({ 
        type: 'executePlan', 
        approach: approach,
        request: userRequest
    });
}

function executePlanChanges() {
    const detailedPlan = document.getElementById('detailedPlan');
    const planContent = document.getElementById('planContent').textContent;
    
    // Parse and execute file edits from detailed plan
    const edits = parseFileEdits(planContent);
    if (edits.length > 0) {
        edits.forEach(edit => {
            executeFileEdit(edit);
        });
        alert(`Executing ${edits.length} file change(s)...`);
    } else {
        alert('No file changes to execute. Review the plan for manual steps.');
    }
}

function cancelPlan() {
    document.getElementById('detailedPlan').style.display = 'none';
    document.getElementById('approaches').innerHTML = '';
    document.getElementById('planLoading').style.display = 'none';
}

function showApproaches(approaches) {
    const approachesDiv = document.getElementById('approaches');
    document.getElementById('planLoading').style.display = 'none';
    
    if (!approaches || approaches.length === 0) {
        approachesDiv.innerHTML = '<div style="color: var(--vscode-errorForeground);">Failed to generate approaches</div>';
        return;
    }
    
    let html = '<div style="display:grid;grid-template-columns:1fr;gap:12px;">';
    approaches.forEach((approach, idx) => {
        html += `
        <div style="border:1px solid var(--vscode-editorGroup-border);border-radius:6px;padding:12px;background:var(--vscode-input-background);">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
                <h5 style="margin:0;color:var(--vscode-editorLink-activeForeground);">${approach.name}</h5>
                <span style="background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);padding:2px 8px;border-radius:3px;font-size:12px;">
                    ${approach.complexity}
                </span>
            </div>
            <p style="margin:0 0 8px 0;font-size:13px;color:var(--vscode-descriptionForeground);">${approach.description}</p>
            <div style="margin:8px 0;">
                <strong style="color:var(--vscode-terminal-ansiGreen);">⊕ Pros:</strong>
                <ul style="margin:4px 0;padding-left:20px;">
                    ${approach.pros.map(p => '<li style="font-size:12px;">' + p + '</li>').join('')}
                </ul>
            </div>
            <div style="margin:8px 0;">
                <strong style="color:var(--vscode-terminal-ansiRed);">⊖ Cons:</strong>
                <ul style="margin:4px 0;padding-left:20px;">
                    ${approach.cons.map(c => '<li style="font-size:12px;">' + c + '</li>').join('')}
                </ul>
            </div>
            <div style="margin:8px 0;font-size:12px;display:flex;gap:12px;padding-top:8px;border-top:1px solid var(--vscode-editorGroup-border);">
                <span>⏱️ ${approach.estimatedTime}</span>
                <span>🛠️ ${approach.tools.join(', ')}</span>
            </div>
            <button onclick="selectApproach(${JSON.stringify(approach).replace(/"/g, '&quot;')})" style="width:100%;margin-top:8px;">
                Select This Approach →
            </button>
        </div>
        `;
    });
    html += '</div>';
    approachesDiv.innerHTML = html;
}

function showDetailedPlan(plan) {
    document.getElementById('planLoading').style.display = 'none';
    document.getElementById('detailedPlan').style.display = 'block';
    document.getElementById('planContent').innerHTML = renderMarkdown(plan);
}

function showChatWindow() {
    const setup = document.getElementById('setup');
    const chat = document.getElementById('chat');

    setup.style.display = 'none';
    chat.style.display = 'flex';

    document.getElementById('messageInput').focus();
}

window.addEventListener('message', event => {
    const msg = event.data;

    if (msg.type === 'initialConfig') {
        if (msg.exists) {
            showChatWindow();
        }
    }

    if (msg.type === 'configSaved') {
        showChatWindow();
    }

    if (msg.type === 'configStatus' && msg.exists) {
        showChatWindow();

        const dropdown = document.getElementById('modelDropdown');
        dropdown.innerHTML = '';

        const option = document.createElement('option');
        option.value = msg.modelName;
        option.textContent = msg.modelName;

        dropdown.appendChild(option);
    }

    if (msg.type === 'messageResponse') {
        document.getElementById('loading').style.display = 'none';
        addMessageToChat('ai', msg.response);
        
        // Parse and execute file edits from LLM response
        const edits = parseFileEdits(msg.response);
        if (edits.length > 0) {
            edits.forEach(edit => {
                executeFileEdit(edit);
            });
        }
    }

    if (msg.type === 'messageError') {
        document.getElementById('loading').style.display = 'none';
        addMessageToChat('ai', 'Error: ' + msg.error);
    }

    if (msg.type === 'toolResult') {
        const out = document.getElementById('toolOutput');
        const bar = document.getElementById('toolOutputBar');
        if (out && bar) {
            try { out.textContent = JSON.stringify(msg.result, null, 2); } catch (e) { out.textContent = String(msg.result); }
            bar.style.display = 'block';
        }
    }

    if (msg.type === 'uploadResult') {
        const out = document.getElementById('toolOutput');
        const bar = document.getElementById('toolOutputBar');
        if (out && bar) {
            out.textContent = '✓ Added ' + (msg.count ?? 0) + ' files to context';
            bar.style.display = 'block';
        }
        if (msg.files) {
            addFilesToContext(msg.files);
        }
    }

    if (msg.type === 'editResult') {
        const out = document.getElementById('toolOutput');
        const bar = document.getElementById('toolOutputBar');
        if (out && bar) {
            if (msg.success) {
                out.textContent = `✓ ${msg.message}`;
            } else {
                out.textContent = `✗ Error: ${msg.error}`;
            }
            bar.style.display = 'block';
        }
    }

    if (msg.type === 'fileContent') {
        const out = document.getElementById('toolOutput');
        const bar = document.getElementById('toolOutputBar');
        if (out && bar) {
            if (msg.error) {
                out.textContent = `Error reading file: ${msg.error}`;
            } else {
                out.textContent = msg.content;
            }
            bar.style.display = 'block';
        }
    }

    if (msg.type === 'planGenerated') {
        showApproaches(msg.approaches);
    }

    if (msg.type === 'detailedPlanReady') {
        showDetailedPlan(msg.plan);
    }

    if (msg.type === 'planError') {
        document.getElementById('planLoading').style.display = 'none';
        const approachesDiv = document.getElementById('approaches');
        approachesDiv.innerHTML = '<div style="color: var(--vscode-errorForeground);">❌ Error: ' + msg.error + '</div>';
    }

    if (msg.type === 'filesSelected') {
        const out = document.getElementById('toolOutput');
        if (out) out.textContent = 'Uploading and adding to context...';
        vscode.postMessage({ type: 'uploadFiles', filePaths: msg.filePaths });
    }

    if (msg.type === 'selectFilesError') {
        const out = document.getElementById('toolOutput');
        if (out) out.textContent = 'Error selecting files: ' + msg.error;
    }
});

// Allow Enter key to send message
document.getElementById('messageInput')?.addEventListener('keypress', function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});

// Ask backend if config exists when page loads
vscode.postMessage({ type: 'checkConfig' });

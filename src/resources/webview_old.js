const vscode = acquireVsCodeApi();
let contextFiles = new Set(); // Store files in current context

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
    vscode.postMessage({ type: 'uploadFiles', scope });
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
        document.getElementById('loading').style.display = 'none';
        addMessageToChat('ai', 'Error: ' + msg.error);
    }

    if (msg.type === 'toolResult') {
        const out = document.getElementById('toolOutput');
        if (out) {
            try { out.textContent = JSON.stringify(msg.result, null, 2); } catch (e) { out.textContent = String(msg.result); }
        }
    }

    if (msg.type === 'uploadResult') {
        const out = document.getElementById('toolOutput');
        if (out) {
            out.textContent = '✓ Added ' + (msg.count ?? 0) + ' files to context';
        }
        if (msg.files) {
            addFilesToContext(msg.files);
        }
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

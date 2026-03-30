import * as vscode from 'vscode';
import { ConfigManager } from './config/configManager';
import { Agent } from './agent/orchestrator';
import { PlanningAgent } from './agent/planner';
import * as agentTools from './agent/tools';
import { traceImports, searchCode } from './core/context';

export function activate(context: vscode.ExtensionContext) {

	console.log("Concur extension activated ✅");
	vscode.window.showInformationMessage("Concur Activated");

	const configManager = new ConfigManager(context);

	const provider = new ConcurViewProvider(context.extensionUri, configManager);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"concur.chatView",
			provider,
			{
				webviewOptions: {
					retainContextWhenHidden: true
				}
			}
		)
	);


}

class ConcurViewProvider implements vscode.WebviewViewProvider {

	private readonly agent: Agent;
	private readonly planner: PlanningAgent;

	constructor(private readonly extensionUri: vscode.Uri,
				private readonly configManager: ConfigManager
			) {
		this.agent = new Agent(this.configManager);
		const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		this.planner = new PlanningAgent(this.configManager, this.agent.getFileStore(), rootPath);
	}

	resolveWebviewView(webviewView: vscode.WebviewView) {

	webviewView.webview.options = {
		enableScripts: true,
		localResourceRoots: [this.extensionUri]
	};

	webviewView.webview.html = this.getHtmlContent(webviewView.webview);


	// Listen to frontend messages
	webviewView.webview.onDidReceiveMessage(async (message) => {

		if (message.type === 'saveConfig') {
			await this.configManager.saveConfig(message.data);
			webviewView.webview.postMessage({ 
				type: 'configSaved' 
			});
		}

	if (message.type === 'checkConfig') {
		const configExists = await this.configManager.hasConfig();

		if (configExists) {
			const config = await this.configManager.getConfig();

			webviewView.webview.postMessage({
				type: 'configStatus',
				exists: true,
				modelName: config.deployment
			});
		} else {
			webviewView.webview.postMessage({
				type: 'configStatus',
				exists: false
			});
		}
	}

		if (message.type === 'sendMessage') {
			try {
				const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
				const response = await this.agent.handleMessage(message.text, activeFile);
				webviewView.webview.postMessage({ 
					type: 'messageResponse', 
					response: response 
				});
			} catch (error) {
				webviewView.webview.postMessage({ 
					type: 'messageError', 
					error: error instanceof Error ? error.message : 'Unknown error' 
				});
			}
		}

		if (message.type === 'uploadFiles') {
			try {
				const filePaths: string[] = message.filePaths || [];
				const filesToUpload: Array<{ path: string; content: string }> = [];

				for (const filePath of filePaths) {
					try {
						const uri = vscode.Uri.file(filePath);
						const stat = await vscode.workspace.fs.stat(uri);
						
						if (stat.type === vscode.FileType.File) {
							// Single file
							const bytes = await vscode.workspace.fs.readFile(uri);
							filesToUpload.push({ path: uri.fsPath, content: Buffer.from(bytes).toString('utf8') });
						} else if (stat.type === vscode.FileType.Directory) {
							// Folder - find all files in it
							const allUris = await vscode.workspace.findFiles(
								new vscode.RelativePattern(uri, '**/*'),
								'**/node_modules/**',
								200
							);
							for (const u of allUris) {
								try {
									const bytes = await vscode.workspace.fs.readFile(u);
									filesToUpload.push({ path: u.fsPath, content: Buffer.from(bytes).toString('utf8') });
								} catch (e) {
									// ignore unreadable files
								}
							}
						}
					} catch (e) {
						// ignore errors for this file
					}
				}

				await this.agent.ingestFiles(filesToUpload);
				const filePaths2 = filesToUpload.map(f => f.path);
				webviewView.webview.postMessage({ type: 'uploadResult', count: filesToUpload.length, files: filePaths2 });
			} catch (err) {
				webviewView.webview.postMessage({ type: 'uploadResult', count: 0, error: String(err) });
			}
		}

		if (message.type === 'selectFiles') {
			try {
				const selected = await vscode.window.showOpenDialog({
					canSelectFiles: true,
					canSelectFolders: true,
					canSelectMany: true,
					title: 'Select Files or Folders to Upload'
				});

				if (selected && selected.length > 0) {
					const filePaths = selected.map(uri => uri.fsPath);
					webviewView.webview.postMessage({ 
						type: 'filesSelected', 
						filePaths: filePaths
					});
				}
			} catch (err) {
				webviewView.webview.postMessage({ type: 'selectFilesError', error: String(err) });
			}
		}

		if (message.type === 'clearContext') {
			try {
				await this.agent.clearFiles();
				webviewView.webview.postMessage({ type: 'contextCleared' });
			} catch (err) {
				webviewView.webview.postMessage({ type: 'contextCleared', error: String(err) });
			}
		}

		if (message.type === 'removeFile') {
			this.agent.removeFile(message.filePath);
		}

		if (message.type === 'traceImports') {
			try {
				const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
				const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				if (!activeFile) {
					webviewView.webview.postMessage({ type: 'uploadResult', count: 0, error: 'No active file open in editor' });
				} else if (!root) {
					webviewView.webview.postMessage({ type: 'uploadResult', count: 0, error: 'No workspace folder open' });
				} else {
					const traced = traceImports(activeFile, root);
					await this.agent.ingestFiles(traced);
					webviewView.webview.postMessage({
						type: 'uploadResult',
						count: traced.length,
						files: traced.map(f => f.path),
					});
				}
			} catch (err) {
				webviewView.webview.postMessage({ type: 'uploadResult', count: 0, error: String(err) });
			}
		}

		if (message.type === 'executeEdit') {
			try {
				const { filePath, content, isNew } = message;
				const uri = vscode.Uri.file(filePath);
				
				const bytes = Buffer.from(content, 'utf8');
				await vscode.workspace.fs.writeFile(uri, bytes);
				
				// Open the file in editor
				const document = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(document);
				
				const action = isNew ? 'created' : 'modified';
				webviewView.webview.postMessage({ 
					type: 'editResult', 
					success: true, 
					filePath, 
					action,
					message: `File ${action}: ${filePath}`
				});
			} catch (err) {
				webviewView.webview.postMessage({ 
					type: 'editResult', 
					success: false, 
					error: String(err) 
				});
			}
		}

		if (message.type === 'readFile') {
			try {
				const { filePath } = message;
				const uri = vscode.Uri.file(filePath);
				const bytes = await vscode.workspace.fs.readFile(uri);
				const content = Buffer.from(bytes).toString('utf8');
				webviewView.webview.postMessage({ 
					type: 'fileContent', 
					filePath: filePath,
					content
				});
			} catch (err) {
				const filePath = (message as any).filePath || 'unknown';
				webviewView.webview.postMessage({ 
					type: 'fileContent', 
					filePath: filePath,
					error: String(err)
				});
			}
		}

		if (message.type === 'invokeTool') {
			try {
				let result: any = null;
				const tool = message.tool;

				switch (tool) {
					case 'listFiles':
						result = await agentTools.listFiles('');
						break;
					case 'readActiveFile':
						result = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.getText() : '';
						break;
					case 'searchTodos':
						{
							const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 2000);
							const matches: string[] = [];
							for (const u of uris) {
								try {
									const bytes = await vscode.workspace.fs.readFile(u);
									const text = Buffer.from(bytes).toString('utf8');
									if (text.includes('TODO')) matches.push(u.fsPath);
								} catch (e) {
								// ignore read errors
							}
							}
							result = matches.slice(0,200);
						}
						break;
					case 'runNpmTest':
						{
							const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? undefined;
							result = await agentTools.executeCommand('npm test', root);
						}
						break;
					case 'searchCode':
						{
							const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
							if (!root) {
								result = { error: 'No workspace folder open' };
							} else {
								result = searchCode(message.query ?? '', root, { maxResults: 50 });
							}
						}
						break;
					default:
						result = { error: 'Unknown tool: ' + tool };
				}

				webviewView.webview.postMessage({ type: 'toolResult', tool, result });
			} catch (err) {
				webviewView.webview.postMessage({ type: 'toolResult', tool: message.tool, result: { error: String(err) } });
			}
		}

		if (message.type === 'generatePlan') {
			try {
				const userRequest = message.request;
				const approaches = await this.planner.generatePlan(userRequest);
				webviewView.webview.postMessage({ 
					type: 'planGenerated', 
					approaches: approaches
				});
			} catch (error) {
				webviewView.webview.postMessage({ 
					type: 'planError', 
					error: error instanceof Error ? error.message : 'Failed to generate plan'
				});
			}
		}

		if (message.type === 'executePlan') {
			try {
				const selectedApproach = message.approach;
				const userRequest = message.request;
				const detailedPlan = await this.planner.getDetailedPlan(selectedApproach.id, selectedApproach, userRequest);
				webviewView.webview.postMessage({ 
					type: 'detailedPlanReady', 
					plan: detailedPlan
				});
			} catch (error) {
				webviewView.webview.postMessage({ 
					type: 'planError', 
					error: error instanceof Error ? error.message : 'Failed to get detailed plan'
				});
			}
		}

	});
}

private async sendMessageToAzure(userMessage: string): Promise<string> {
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
				{ role: 'user', content: userMessage }
			],
			model: config.deployment,
			max_completion_tokens: 20000,

			
		})
	});

	if (!response.ok) {
		const errorData = await response.text();
		throw new Error(`Azure API Error: ${response.status} - ${errorData}`);
	}

	const data = await response.json() as { choices: Array<{ message: { content: string } }> };
	return data.choices[0].message.content;
}

private getHtmlContent(webview: vscode.Webview): string {
	const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'resources', 'styles.css'));
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'resources', 'webview.js'));

	return `
	<!DOCTYPE html>
	<html>
	<head>
		<link rel="stylesheet" href="${stylesUri}">
	</head>
	<body>
		<div id="setup">
			<h3>Azure Configuration</h3>
			<input id="endpoint" placeholder="Azure Endpoint" />
			<input id="deployment" placeholder="Deployment Name" />
			<input id="version" placeholder="API Version" />
			<input id="key" type="password" placeholder="API Key" />
			<button onclick="save()">Save</button>
		</div>

		<div id="chat" style="display:none;flex-direction:column;height:100vh;padding:0;">
			<!-- File Context & Tools Bar -->
			<div id="toolsBar" style="padding:8px;border-bottom:1px solid var(--vscode-editorGroup-border);background:var(--vscode-editor-background);flex-shrink:0;">
				<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;font-size:12px;">
					<button onclick="selectFiles()" style="padding:4px 8px;font-size:11px;white-space:nowrap;">📁 Files</button>
					<button onclick="traceActiveImports()" style="padding:4px 8px;font-size:11px;white-space:nowrap;" title="Trace imports of the active editor file and add them to context">🔗 Trace</button>
					<button onclick="clearContext()" style="padding:4px 8px;font-size:11px;white-space:nowrap;background-color:var(--vscode-button-secondaryBackground);">🗑️ Clear</button>
					<span style="color:var(--vscode-descriptionForeground);">|</span>
					<button onclick="invokeTool('listFiles')" style="padding:4px 6px;font-size:11px;">List</button>
					<button onclick="invokeTool('readActiveFile')" style="padding:4px 6px;font-size:11px;">View</button>
					<span style="color:var(--vscode-descriptionForeground);">|</span>
					<input id="searchInput" placeholder="Search code..." style="padding:3px 6px;font-size:11px;border:1px solid var(--vscode-editorGroup-border);border-radius:3px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);width:120px;" onkeydown="if(event.key==='Enter')invokeSearch()" />
					<button onclick="invokeSearch()" style="padding:4px 6px;font-size:11px;" title="Grep search across workspace">🔍</button>
				</div>
			</div>

			<!-- Navigation Tabs -->
			<div id="navTabs" style="padding:8px;border-bottom:1px solid var(--vscode-editorGroup-border);display:flex;gap:12px;align-items:center;background:var(--vscode-editor-background);flex-shrink:0;">
				<button onclick="switchTab('chat')" id="chatTab" style="padding:6px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-bottom:2px solid var(--vscode-editorLink-activeForeground);cursor:pointer;font-weight:bold;">💬 Chat</button>
				<button onclick="switchTab('planning')" id="planningTab" style="padding:6px 12px;background:transparent;color:var(--vscode-descriptionForeground);border:none;border-bottom:2px solid transparent;cursor:pointer;">🚀 Planning</button>
				<div style="flex:1;"></div>
				<button onclick="newChat()" style="padding:6px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-foreground);border:none;cursor:pointer;white-space:nowrap;">✨ New Chat</button>
			</div>

			<!-- Chat Section -->
			<div id="chatSection" style="display:flex;flex-direction:column;flex:1;min-height:0;">
				<h3 style="margin:8px;margin-bottom:4px;">Concur Chat ✅</h3>
				<div id="messages" style="flex:1;overflow-y:auto;padding:8px;"></div>
				<div id="loading" style="display:none;padding:8px;color:var(--vscode-descriptionForeground);">AI is thinking...</div>
				<div id="inputContainer" style="padding:8px;border-top:1px solid var(--vscode-editorGroup-border);display:flex;gap:4px;flex-shrink:0;">
					<input id="messageInput" placeholder="Type your message..." style="flex:1;padding:6px;border:1px solid var(--vscode-editorGroup-border);border-radius:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);" />
					<button id="sendButton" onclick="sendMessage()" style="padding:6px 12px;">Send</button>
				</div>
			</div>

			<!-- Planning Section -->
			<div id="planningSection" style="display:none;flex-direction:column;flex:1;min-height:0;padding:8px;overflow-y:auto;">
				<h3 style="margin:0 0 8px 0;">🚀 Planning Agent</h3>
				<textarea id="planInput" placeholder="Describe your development task..." style="width:100%;height:60px;padding:8px;border:1px solid var(--vscode-editorGroup-border);border-radius:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);resize:vertical;margin-bottom:8px;"></textarea>
				<button onclick="generatePlan()" style="width:100%;padding:8px;margin-bottom:8px;">Generate Plans</button>
				
				<div id="planLoading" style="display:none;margin-bottom:8px;padding:8px;background:var(--vscode-editorInfoBackground);border-radius:4px;color:var(--vscode-editorInfoForeground);font-size:12px;">
					⏳ Generating approaches...
				</div>
				
				<div id="approaches" style="overflow-y:auto;flex:1;margin-bottom:8px;"></div>
				
				<div id="detailedPlan" style="display:none;flex-direction:column;gap:8px;overflow-y:auto;flex:1;">
					<h5 style="margin:0;">Implementation Plan:</h5>
					<div id="planContent" style="padding:8px;background:var(--vscode-input-background);border-radius:4px;border:1px solid var(--vscode-editorGroup-border);overflow-y:auto;flex:1;"></div>
					<div style="display:flex;gap:8px;">
						<button onclick="executePlanChanges()" style="flex:1;padding:8px;">✓ Execute</button>
						<button onclick="cancelPlan()" style="flex:1;padding:8px;background-color:var(--vscode-button-secondaryBackground);">Cancel</button>
					</div>
				</div>
			</div>

			<!-- Tool Output -->
			<div id="toolOutputBar" style="padding:8px;border-top:1px solid var(--vscode-editorGroup-border);background:var(--vscode-editor-background);flex-shrink:0;display:none;">
				<pre id="toolOutput" style="white-space:pre-wrap;max-height:100px;overflow:auto;margin:0;padding:4px;border:1px solid var(--vscode-editorGroup-border);border-radius:3px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font-size:11px;"></pre>
			</div>
		</div>

		<script src="${scriptUri}"><\/script>
	</body>
	</html>	
	`;
}
}

export function deactivate() {}
// src/config/configManager.ts

import * as vscode from 'vscode';

const ENDPOINT_KEY = 'azure.endpoint';
const DEPLOYMENT_KEY = 'azure.deployment';
const API_VERSION_KEY = 'azure.apiVersion';
const SECRET_KEY = 'azure.apiKey';

export class ConfigManager {
    constructor(private context: vscode.ExtensionContext) {}

    async ensureConfig(): Promise<void> {
        const endpoint = this.context.globalState.get<string>(ENDPOINT_KEY);
        const deployment = this.context.globalState.get<string>(DEPLOYMENT_KEY);
        const apiVersion = this.context.globalState.get<string>(API_VERSION_KEY);
        const apiKey = await this.context.secrets.get(SECRET_KEY);

        if (endpoint && deployment && apiVersion && apiKey) {
            return;
        }

        await this.promptForConfig();
    }

    async promptForConfig() {
        const endpoint = await vscode.window.showInputBox({
            prompt: 'Enter Azure OpenAI Endpoint',
            ignoreFocusOut: true
        });

        const deployment = await vscode.window.showInputBox({
            prompt: 'Enter Azure OpenAI Deployment Name',
            ignoreFocusOut: true
        });

        const apiVersion = await vscode.window.showInputBox({
            prompt: 'Enter Azure OpenAI API Version (e.g., 2024-02-15-preview)',
            ignoreFocusOut: true
        });

        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter Azure OpenAI API Key',
            password: true,
            ignoreFocusOut: true
        });

        if (!endpoint || !deployment || !apiVersion || !apiKey) {
            vscode.window.showErrorMessage('Azure configuration incomplete.');
            throw new Error('Azure configuration incomplete.');
        }

        await this.context.globalState.update(ENDPOINT_KEY, endpoint);
        await this.context.globalState.update(DEPLOYMENT_KEY, deployment);
        await this.context.globalState.update(API_VERSION_KEY, apiVersion);
        await this.context.secrets.store(SECRET_KEY, apiKey);

        vscode.window.showInformationMessage('Azure configuration saved ✅');
    }
    async getActiveModel() {
	const endpoint = this.context.globalState.get<string>(ENDPOINT_KEY)!;
	const deployment = this.context.globalState.get<string>(DEPLOYMENT_KEY)!;
	const apiVersion = this.context.globalState.get<string>(API_VERSION_KEY)!;
	const apiKey = await this.context.secrets.get(SECRET_KEY)!;

	return {
            endpoint,
            deployment,
            apiVersion,
            apiKey
        };
    }

    async getConfig() {
        return {
            endpoint: this.context.globalState.get<string>(ENDPOINT_KEY)!,
            deployment: this.context.globalState.get<string>(DEPLOYMENT_KEY)!,
            apiVersion: this.context.globalState.get<string>(API_VERSION_KEY)!,
            apiKey: await this.context.secrets.get(SECRET_KEY)!
        };
    }
    async hasConfig(): Promise<boolean> {
	const endpoint = this.context.globalState.get<string>(ENDPOINT_KEY);
	const deployment = this.context.globalState.get<string>(DEPLOYMENT_KEY);
	const apiVersion = this.context.globalState.get<string>(API_VERSION_KEY);
	const apiKey = await this.context.secrets.get(SECRET_KEY);

    console.log("=== CONFIG CHECK ===");
	console.log("Endpoint:", endpoint);
	console.log("Deployment:", deployment);
	console.log("ApiVersion:", apiVersion);
	console.log("ApiKey exists:", !!apiKey);
	console.log("====================");

	return !!(endpoint && deployment && apiVersion && apiKey);

	return !!(endpoint && deployment && apiVersion && apiKey);
}

async saveConfig(data: {
	endpoint: string;
	deployment: string;
	apiVersion: string;
	apiKey: string;
}) {

	await this.context.globalState.update(ENDPOINT_KEY, data.endpoint);
	await this.context.globalState.update(DEPLOYMENT_KEY, data.deployment);
	await this.context.globalState.update(API_VERSION_KEY, data.apiVersion);
	await this.context.secrets.store(SECRET_KEY, data.apiKey);
    console.log("✅ Config saved successfully");


	vscode.window.showInformationMessage('Azure configuration saved ✅');
}
}
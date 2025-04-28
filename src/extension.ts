// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';

// Constants for secret storage
const SECRET_STORAGE_KEY = 'codexpilotGeminiApiKey';

/**
 * Helper function to retrieve the API key from secure storage
 */
async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    return await context.secrets.get(SECRET_STORAGE_KEY);
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codexpilot" is now active!');

	// Show a notification to confirm the extension is activated
	vscode.window.showInformationMessage('Codexpilot extension is now active!');

	// Register the ChatViewProvider
	const chatViewProvider = new ChatViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ChatViewProvider.viewType,
			chatViewProvider
		)
	);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const helloWorldCommand = vscode.commands.registerCommand('codexpilot.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from codexpilot!');
	});

	// Register the command to set the Gemini API key
	const setApiKeyCommand = vscode.commands.registerCommand('codexpilot.setApiKey', async () => {
		// Prompt the user for their API key
		const apiKey = await vscode.window.showInputBox({
			prompt: "Enter your Google AI Studio API Key for Gemini",
			password: true, // Mask the input for security
			ignoreFocusOut: true, // Prevent the box from closing easily
			placeHolder: "Paste your API Key here"
		});

		// Check if an API key was provided
		if (apiKey) {
			// Store the API key securely
			await context.secrets.store(SECRET_STORAGE_KEY, apiKey);
			vscode.window.showInformationMessage('Codexpilot: Gemini API Key stored successfully.');
		} else {
			// User cancelled or didn't provide a key
			vscode.window.showWarningMessage('Codexpilot: API Key not provided.');
		}
	});

	// Add all disposables to the subscriptions
	context.subscriptions.push(helloWorldCommand, setApiKeyCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';
import { SavedChatSession } from './interfaces';

// Constants for secret storage
const SECRET_STORAGE_KEY = 'codexpilotGeminiApiKey';

// Constants for chat history storage
const HISTORY_STORAGE_KEY = 'codexpilotChatHistoryList';
const MAX_SAVED_CHATS = 20;

// Store context file URIs
let contextFileUris: vscode.Uri[] = [];

// Store a reference to the ChatViewProvider instance
let chatProviderInstance: ChatViewProvider | null = null;

// Store a reference to the extension context
let extensionContext: vscode.ExtensionContext;

/**
 * Helper function to retrieve the API key from secure storage
 */
export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    return await context.secrets.get(SECRET_STORAGE_KEY);
}

/**
 * Get the list of saved chat sessions
 * @param context The extension context
 * @returns An array of saved chat sessions
 */
export function getChatHistoryList(context: vscode.ExtensionContext): SavedChatSession[] {
    return context.workspaceState.get<SavedChatSession[]>(HISTORY_STORAGE_KEY, []);
}

/**
 * Save a chat session to the history
 * @param context The extension context
 * @param sessionToSave The chat session to save
 */
export function saveChatSession(context: vscode.ExtensionContext, sessionToSave: SavedChatSession): void {
    // Get the current list
    const currentList = getChatHistoryList(context);

    // Remove any existing session with the same ID (to handle updates)
    const filteredList = currentList.filter(session => session.id !== sessionToSave.id);

    // Add the new session to the beginning of the list
    const updatedList = [sessionToSave, ...filteredList];

    // Sort the list by timestamp descending
    updatedList.sort((a, b) => b.timestamp - a.timestamp);

    // Trim the list if it exceeds the maximum number of saved chats
    const trimmedList = updatedList.slice(0, MAX_SAVED_CHATS);

    // Update the workspace state
    context.workspaceState.update(HISTORY_STORAGE_KEY, trimmedList);

    console.log(`Saved chat session: ${sessionToSave.id} - ${sessionToSave.title}`);
}

/**
 * Get a chat session by ID
 * @param context The extension context
 * @param chatId The chat ID to find
 * @returns The chat session with the specified ID, or undefined if not found
 */
export function getChatSessionById(context: vscode.ExtensionContext, chatId: string): SavedChatSession | undefined {
    const chatList = getChatHistoryList(context);
    return chatList.find(session => session.id === chatId);
}

/**
 * Set the active context URIs
 * @param uris The URIs to set as the active context
 */
export function setActiveContextUris(uris: vscode.Uri[]): void {
    contextFileUris = [...uris];
    updateContextInWebview();
}

/**
 * Get the current context file URIs
 */
export function getContextFileUris(): vscode.Uri[] {
    return [...contextFileUris];
}

/**
 * Update the context files list in the webview
 */
function updateContextInWebview() {
    if (chatProviderInstance) {
        // Convert URIs to relative paths for display
        const fileNames = contextFileUris.map(uri => vscode.workspace.asRelativePath(uri));

        // Send the update to the webview
        chatProviderInstance.sendMessageToWebview({
            type: 'contextUpdated',
            files: fileNames
        });
    }
}

/**
 * Add a file to the context
 * @param fileUri The URI of the file to add
 * @returns A promise that resolves to a boolean indicating whether the file was added
 */
export async function addFileToContext(fileUri: vscode.Uri): Promise<boolean> {
    try {
        // Check if it's a file (not a directory)
        const stat = await vscode.workspace.fs.stat(fileUri);
        if (stat.type === vscode.FileType.File) {
            // Check if the file is already in the context
            const fileUriString = fileUri.toString();
            const isAlreadyInContext = contextFileUris.some(uri => uri.toString() === fileUriString);

            if (!isAlreadyInContext) {
                // Add the file to the context
                contextFileUris.push(fileUri);

                // Update the webview
                updateContextInWebview();
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('Error adding file to context:', error);
        return false;
    }
}

/**
 * Clear all files from the context
 */
export function clearContext() {
    contextFileUris = [];
    updateContextInWebview();
}

/**
 * Remove a file from the context
 * @param fileUri The URI of the file to remove
 * @returns A promise that resolves to true if the file was removed, false otherwise
 */
export async function removeFileFromContext(fileUri: vscode.Uri): Promise<boolean> {
    try {
        // Check if the file is in the context
        const fileUriString = fileUri.toString();
        const index = contextFileUris.findIndex(uri => uri.toString() === fileUriString);

        if (index === -1) {
            console.log(`File ${fileUri.fsPath} is not in the context`);
            return false;
        }

        // Remove the file from the context
        contextFileUris.splice(index, 1);
        console.log(`Removed file ${fileUri.fsPath} from the context`);

        // Update the context in the webview
        updateContextInWebview();

        return true;
    } catch (error) {
        console.error(`Error removing file ${fileUri.fsPath} from the context:`, error);
        return false;
    }
}

/**
 * Search for files in the workspace
 * @param query The search query
 * @param maxResults The maximum number of results to return
 * @returns A promise that resolves to an array of file URIs
 */
export async function searchWorkspaceFiles(query: string, maxResults: number = 10): Promise<vscode.Uri[]> {
    console.log('searchWorkspaceFiles called with query:', query, 'maxResults:', maxResults);

    try {
        // Use a broad glob pattern to get all files
        // We'll filter them case-insensitively afterwards
        const searchPattern = `**/*.*`;

        console.log('Search pattern:', searchPattern);
        console.log('Exclude pattern:', '**/node_modules/**');

        // Search for all files
        console.log('Calling vscode.workspace.findFiles...');
        const allFiles = await vscode.workspace.findFiles(
            searchPattern,
            '**/node_modules/**', // Exclude node_modules
            1000 // Get more files than we need to ensure we have enough after filtering
        );

        // Filter files case-insensitively
        const queryLower = query.toLowerCase();
        console.log('Filtering files with lowercase query:', queryLower);

        // Log if query contains special characters
        if (query.includes('.') || query.includes('/') || query.includes('\\')) {
            console.log('Query contains special characters:',
                        query.includes('.') ? 'dot' : '',
                        query.includes('/') ? 'forward-slash' : '',
                        query.includes('\\') ? 'backslash' : '');
        }

        const filteredFiles = allFiles.filter(uri => {
            // Get just the filename part (not the full path)
            const fileName = uri.path.split('/').pop() || '';
            // Also get the full path for broader matching
            const fullPath = vscode.workspace.asRelativePath(uri);

            const fileNameLower = fileName.toLowerCase();
            const fullPathLower = fullPath.toLowerCase();

            // Check if the filename or path contains the query (case-insensitive)
            const matchesFileName = fileNameLower.includes(queryLower);
            const matchesPath = fullPathLower.includes(queryLower);

            // Log some sample matches for debugging
            if ((matchesFileName || matchesPath) && Math.random() < 0.1) { // Only log ~10% of matches to avoid console spam
                console.log(`Match found: "${fullPath}" (matches filename: ${matchesFileName}, matches path: ${matchesPath})`);
            }

            return matchesFileName || matchesPath;
        }).slice(0, maxResults); // Limit to requested number of results

        console.log('Files found after filtering:', filteredFiles.length);
        if (filteredFiles.length > 0) {
            console.log('First few files:', filteredFiles.slice(0, 5).map(uri => uri.toString()));
        }

        return filteredFiles;
    } catch (error) {
        console.error('Error searching workspace files:', error);
        return [];
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codexpilot" is now active!');

	// Show a notification to confirm the extension is activated
	vscode.window.showInformationMessage('Codexpilot extension is now active!');

    // Store the extension context for later use
    extensionContext = context;

	// Register the ChatViewProvider with access to context management functions
	const chatViewProvider = new ChatViewProvider(
        context.extensionUri,
        context,
        {
            searchWorkspaceFiles,
            addFileToContext
        }
    );
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ChatViewProvider.viewType,
			chatViewProvider
		)
	);

    // Store the provider instance for later use
    chatProviderInstance = chatViewProvider;

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
			vscode.window.showInformationMessage('Codexpilot: API Key stored successfully.');
		} else {
			// User cancelled or didn't provide a key
			vscode.window.showWarningMessage('Codexpilot: API Key not provided.');
		}
	});

    // Register the command to clear the context
    const clearContextCommand = vscode.commands.registerCommand('codexpilot.clearContext', () => {
        // Clear the context files array
        clearContext();
        vscode.window.showInformationMessage('Codexpilot: Context cleared.');
    });

	// Add all disposables to the subscriptions
	context.subscriptions.push(
        helloWorldCommand,
        setApiKeyCommand,
        clearContextCommand
    );
}

// This method is called when your extension is deactivated
export function deactivate() {
    // Save the current chat session if there is one
    if (chatProviderInstance) {
        const history = chatProviderInstance.getCurrentHistory();
        const contextUriStrings = chatProviderInstance.getCurrentContextUriStrings();
        const currentChatId = chatProviderInstance.getCurrentChatId();

        // Only save if there are messages in the history
        if (history.length > 0) {
            // Generate an ID if one doesn't exist
            const id = currentChatId || Date.now().toString();

            // Get the first user message for the title
            let title = 'Chat Session';
            for (const message of history) {
                if (message.role === 'user') {
                    // Extract a title from the first user message
                    const userText = message.parts[0].text;
                    // Remove context prefix if present
                    const userQuery = userText.includes('USER QUERY:')
                        ? userText.split('USER QUERY:')[1].trim()
                        : userText;

                    // Limit title length
                    title = userQuery.length > 50
                        ? userQuery.substring(0, 47) + '...'
                        : userQuery;

                    break;
                }
            }

            // Create the session object
            const sessionToSave = {
                id: id,
                title: title,
                timestamp: Date.now(),
                conversationHistory: history,
                contextUriStrings: contextUriStrings
            };

            // Save the session
            saveChatSession(extensionContext, sessionToSave);
            console.log(`Saved chat session on deactivate: ${sessionToSave.id} - ${sessionToSave.title}`);
        }
    }
}

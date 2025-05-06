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

// Store manually added context file URIs
let manuallyAddedContextUris = new Set<string>();

// Store the automatically tracked file URI
let currentAutoContextUri: vscode.Uri | null = null;

// Flag to control whether the auto-tracked file is included in context
let isAutoContextActive: boolean = true;

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
 * Set the active context URIs (replaces all existing context)
 * @param uris The URIs to set as the active context
 */
export function setActiveContextUris(uris: vscode.Uri[]): void {
    // Clear existing context
    manuallyAddedContextUris.clear();
    currentAutoContextUri = null;

    // Add all URIs as manually added context
    for (const uri of uris) {
        manuallyAddedContextUris.add(uri.toString());
    }

    // Sync the updated state to the webview
    syncContextStateToWebview();
}

/**
 * Get the current context file URIs (both manual and auto)
 * @returns An array of all context URIs
 */
export function getContextFileUris(): vscode.Uri[] {
    const result: vscode.Uri[] = [];

    // Add all manually added URIs
    for (const uriString of manuallyAddedContextUris) {
        try {
            result.push(vscode.Uri.parse(uriString));
        } catch (error) {
            console.error(`Error parsing URI string: ${uriString}`, error);
        }
    }

    // Add the auto context URI if it exists, is not already in the result, and is active
    if (currentAutoContextUri && isAutoContextActive) {
        const autoUriString = currentAutoContextUri.toString();
        if (!manuallyAddedContextUris.has(autoUriString)) {
            result.push(currentAutoContextUri);
        }
    }

    return result;
}

/**
 * Toggle the auto context active state
 * This function toggles whether the auto-tracked file is included in the context
 */
export function toggleAutoContextActive(): void {
    // Toggle the state
    isAutoContextActive = !isAutoContextActive;

    console.log(`>>> Toggled auto context active state: ${isAutoContextActive}`);

    // Sync the updated state to the webview
    syncContextStateToWebview();
}

/**
 * Get a URI from the context by its string representation
 * @param uriString The string representation of the URI to find
 * @returns The URI object if found, undefined otherwise
 */
export function getContextUriByString(uriString: string): vscode.Uri | undefined {
    // Check if it's in the manually added URIs
    if (manuallyAddedContextUris.has(uriString)) {
        return vscode.Uri.parse(uriString);
    }

    // Check if it's the auto context URI
    if (currentAutoContextUri && currentAutoContextUri.toString() === uriString) {
        return currentAutoContextUri;
    }

    return undefined;
}

/**
 * Add a URI to the manually added context if it doesn't already exist
 * @param uri The URI to add to the context
 * @returns True if the URI was added, false if it already existed or couldn't be added
 */
export function addUriToContext(uri: vscode.Uri): boolean {
    // Get the string representation of the URI
    const uriString = uri.toString();

    // Check if the URI is already in the manually added context
    if (manuallyAddedContextUris.has(uriString)) {
        console.log(`>>> URI already in manual context: ${uriString}`);
        return false;
    }

    // Add the URI to the manually added context
    const previousSize = manuallyAddedContextUris.size;
    manuallyAddedContextUris.add(uriString);

    // Check if the URI was actually added
    if (manuallyAddedContextUris.size > previousSize) {
        console.log(`>>> Added URI to manual context: ${uriString}`);

        // Sync the updated state to the webview
        syncContextStateToWebview();

        return true;
    }

    return false;
}

/**
 * Remove a URI from the manually added context by its string representation
 * @param uriString The string representation of the URI to remove
 * @returns True if the URI was removed, false if it wasn't found
 */
export function removeUriFromContext(uriString: string): boolean {
    // Check if the URI is in the manually added context
    if (!manuallyAddedContextUris.has(uriString)) {
        console.log(`>>> URI not found in manual context: ${uriString}`);
        return false;
    }

    // Remove the URI from the manually added context
    const result = manuallyAddedContextUris.delete(uriString);

    if (result) {
        console.log(`>>> Removed URI from manual context: ${uriString}`);

        // Sync the updated state to the webview
        syncContextStateToWebview();
    }

    return result;
}

/**
 * Clear all URIs from the context (both manual and auto)
 */
export function clearContextUris(): void {
    // Clear manually added URIs
    manuallyAddedContextUris.clear();

    // Clear auto context URI
    currentAutoContextUri = null;

    console.log('>>> Cleared all URIs from context');

    // Sync the updated state to the webview
    syncContextStateToWebview();
}

/**
 * Sync the current context state to the webview
 * This should be called after any modification to the context state
 */
export function syncContextStateToWebview(): void {
    console.log('>>> syncContextStateToWebview called');

    // Get all context URIs (both manual and auto)
    const allContextUris = getContextFileUris();
    console.log('>>> Current context URIs:', allContextUris.map(uri => uri.toString()));

    if (chatProviderInstance) {
        // Prepare data for the webview
        const contextItems = [];

        // Add manually added URIs
        for (const uriString of manuallyAddedContextUris) {
            try {
                const uri = vscode.Uri.parse(uriString);
                contextItems.push({
                    uriString: uriString,
                    path: vscode.workspace.asRelativePath(uri),
                    isCurrent: false
                });
            } catch (error) {
                console.error(`Error parsing URI string: ${uriString}`, error);
            }
        }

        // Add auto context URI if it exists and is not already in the manual set
        if (currentAutoContextUri) {
            const autoUriString = currentAutoContextUri.toString();
            if (!manuallyAddedContextUris.has(autoUriString)) {
                contextItems.push({
                    uriString: autoUriString,
                    path: vscode.workspace.asRelativePath(currentAutoContextUri),
                    isCurrent: true,
                    isActive: isAutoContextActive // Include the active state flag
                });
            }
        }

        // Extract paths and URI strings for backward compatibility
        const contextPaths = contextItems.map(item => item.path);
        const contextUriStrings = contextItems.map(item => item.uriString);

        // Send the new message format with context items
        chatProviderInstance.sendMessageToWebview({
            type: 'updateContextPills',
            contextItems: contextItems,
            contextPaths: contextPaths,
            contextUriStrings: contextUriStrings
        });
        console.log(`>>> State Sync: Sent updateContextPills to webview with ${contextItems.length} files.`);

        // Also send the legacy message for backward compatibility
        chatProviderInstance.sendMessageToWebview({
            type: 'contextUpdated',
            files: contextPaths
        });
    } else {
        console.log('>>> chatProviderInstance is null, cannot update webview');
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
            // Use the new addUriToContext function
            return addUriToContext(fileUri);
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
    // Use the new clearContextUris function
    clearContextUris();
}

/**
 * Remove a file from the context
 * @param fileUri The URI of the file to remove
 * @returns A promise that resolves to true if the file was removed, false otherwise
 */
export async function removeFileFromContext(fileUri: vscode.Uri): Promise<boolean> {
    try {
        // Use the new removeUriFromContext function
        return removeUriFromContext(fileUri.toString());
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

/**
 * Handle changes to the active editor
 * This function updates the auto context URI when the active editor changes
 * @param editor The new active editor
 */
export function handleActiveEditorChange(editor: vscode.TextEditor | undefined): void {
    console.log('>>> handleActiveEditorChange called');

    // Get the old auto context URI string for comparison
    const oldAutoUriString = currentAutoContextUri?.toString();
    let newAutoUri: vscode.Uri | null = null;

    // If there's a valid editor with a file
    if (editor && editor.document && editor.document.uri) {
        // Check if it's a file in the workspace (not an untitled file or output panel)
        if (editor.document.uri.scheme === 'file') {
            // Check if it's in a workspace folder
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (workspaceFolder) {
                // Set the new auto context URI
                newAutoUri = editor.document.uri;
                console.log(`>>> Auto context updated to: ${newAutoUri.toString()}`);
            } else {
                console.log('>>> Auto context not updated (file not in workspace folder)');
            }
        } else {
            // Not a valid workspace file
            console.log('>>> Auto context not updated (not a workspace file)');
        }
    } else {
        // No active editor
        console.log('>>> Auto context not updated (no active editor)');
    }

    // Get the new auto context URI string for comparison
    const newAutoUriString = newAutoUri?.toString();

    // Reset eye state ONLY if the auto-context file actually changes
    if (newAutoUriString !== oldAutoUriString) {
        console.log('>>> Auto-context file changed, resetting visibility to active.');
        isAutoContextActive = true;
    }

    // Update the tracked URI
    currentAutoContextUri = newAutoUri;

    // If the auto context has changed, sync the state to the webview
    if (newAutoUriString !== oldAutoUriString) {
        syncContextStateToWebview();
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
			// Basic validation - Gemini API keys are typically around 39 characters
			const MIN_KEY_LENGTH = 35;
			if (apiKey.trim().length < MIN_KEY_LENGTH) {
				vscode.window.showErrorMessage('Codexpilot: Invalid API Key format. Key seems too short.');
				return;
			}

			// Key looks potentially valid, store it (trimmed to remove any accidental whitespace)
			await context.secrets.store(SECRET_STORAGE_KEY, apiKey.trim());
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

	// Register the event listener for active editor changes
	const activeEditorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(handleActiveEditorChange);

	// Initialize with the current active editor
	handleActiveEditorChange(vscode.window.activeTextEditor);

	// Add all disposables to the subscriptions
	context.subscriptions.push(
        helloWorldCommand,
        setApiKeyCommand,
        clearContextCommand,
        activeEditorChangeDisposable
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

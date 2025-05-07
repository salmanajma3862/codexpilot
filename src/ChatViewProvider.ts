import * as vscode from 'vscode';
import { callGeminiApiStream } from './geminiApi';
import {
    getApiKey,
    getContextFileUris,
    removeUriFromContext,
    addUriToContext,
    clearContextUris
} from './extension';
import { ChatMessage, SavedChatSession } from './interfaces';

// Interface for context management functions
interface ContextManagement {
    searchWorkspaceFiles: (query: string, maxResults?: number) => Promise<vscode.Uri[]>;
    addFileToContext: (fileUri: vscode.Uri) => Promise<boolean>;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codexpilotChatView';

    private _view?: vscode.WebviewView;
    private _contextManagement: ContextManagement;
    private _currentContextUris: vscode.Uri[] = [];
    private _isProcessingMessage: boolean = false;

    // AbortController for cancelling API requests
    private currentApiAbortController: AbortController | null = null;

    // Conversation history for Gemini API
    private conversationHistory: ChatMessage[] = [];
    private readonly MAX_HISTORY_LENGTH = 20; // Keep last 20 messages (10 turns)

    // Current chat ID
    private currentChatId: string | null = null;

    // Selection modification state
    private activeSelectionModificationInfo?: {
        documentUri: vscode.Uri;
        selectionRange: vscode.Range;
        originalSelectedText: string;
    };

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        contextManagement?: ContextManagement
    ) {
        // If context management functions are provided, use them
        // Otherwise, create dummy functions that do nothing
        this._contextManagement = contextManagement || {
            searchWorkspaceFiles: async () => [],
            addFileToContext: async () => false
        };
    }

    /**
     * Called when the webview view is first created or becomes visible again after being hidden.
     * This is the main initialization point for the webview UI.
     *
     * @param webviewView The webview view to configure
     * @param _context Context containing information about the resolve operation
     * @param _token Cancellation token for the resolve operation
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        // Store a reference to the webview view for later use
        this._view = webviewView;

        // Configure webview security options
        webviewView.webview.options = {
            // Enable JavaScript in the webview
            enableScripts: true,
            // Restrict the webview to only load resources from the extension's directory
            localResourceRoots: [this._extensionUri]
        };

        // Set the HTML content for the webview
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Set up message handling from the webview
        // This is the communication channel between the extension and the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log('Received message from webview:', message);

            try {
                // Validate message
                if (!message || typeof message !== 'object') {
                    throw new Error('Invalid message received from webview');
                }

                // Handle different message types with their corresponding handlers
                switch (message.type) {
                    case 'sendMessage':
                        // User has sent a message/query to the AI
                        if (!message.text || typeof message.text !== 'string') {
                            throw new Error('Invalid message text');
                        }
                        console.log('User message:', message.text);
                        await this.handleUserQuery(message.text);
                        break;

                    case 'searchWorkspaceFiles':
                        // User is searching for files to add to context
                        if (!message.query || typeof message.query !== 'string') {
                            throw new Error('Invalid search query');
                        }
                        console.log('Received searchWorkspaceFiles request with query:', message.query);
                        await this.handleFileSearch(message.query);
                        break;

                    case 'addFileToContextViaMention':
                        // User has selected a file to add to context via @ mention
                        if (!message.uriString || typeof message.uriString !== 'string') {
                            throw new Error('Invalid URI string');
                        }
                        console.log('Received addFileToContextViaMention request with URI:', message.uriString);
                        await this.handleAddFileToContext(message.uriString);
                        break;

                    case 'insertCode':
                        // User wants to insert code from a response into the editor
                        if (!message.code || typeof message.code !== 'string') {
                            throw new Error('Invalid code content');
                        }
                        console.log('Received insertCode request with code length:', message.code.length);
                        await this.handleInsertCode(message.code);
                        break;

                    case 'removeFileFromContext':
                        // User has removed a file from context (clicked X on a pill)
                        if (!message.uriString || typeof message.uriString !== 'string') {
                            throw new Error('Invalid URI string');
                        }
                        console.log('Received removeFileFromContext request with URI:', message.uriString);
                        await this.handleRemoveFileFromContext(message.uriString);
                        break;

                    case 'clearChat':
                        // User wants to start a new chat
                        console.log('Received clearChat request');
                        await this.clearConversationAndContext();
                        break;

                    case 'showInfoMessage':
                        // Show an information message in VS Code
                        if (!message.text || typeof message.text !== 'string') {
                            throw new Error('Invalid message text');
                        }
                        console.log('Received showInfoMessage request:', message.text);
                        vscode.window.showInformationMessage(message.text);
                        break;

                    case 'showHistory':
                        // User wants to view chat history
                        console.log('Received showHistory request');
                        await this.showHistory();
                        break;

                    case 'getRecentFiles':
                        // User wants to see recently opened files (for @ mentions)
                        console.log('Received getRecentFiles request');
                        await this.getRecentFiles();
                        break;

                    case 'requestContextUpdate':
                        // Frontend is requesting a context update
                        console.log('>>> Received requestContextUpdate');
                        this.sendContextUpdateToWebview();
                        break;

                    case 'toggleAutoContextActive':
                        // Toggle the auto context active state
                        console.log('>>> Received toggleAutoContextActive');
                        // Import the function to access the global state
                        const { toggleAutoContextActive } = require('./extension');
                        toggleAutoContextActive();
                        break;

                    case 'getActiveSelectionInfo':
                        // User wants to modify selected code
                        console.log('Received getActiveSelectionInfo request');
                        await this.handleGetActiveSelectionInfo();
                        break;

                    case 'applySelectionModification':
                        // User wants to apply a code modification to the selection
                        if (!message.suggestedCode || typeof message.suggestedCode !== 'string') {
                            throw new Error('Invalid suggested code');
                        }
                        console.log('Received applySelectionModification request');
                        await this.handleApplySelectionModification(message.suggestedCode);
                        break;

                    case 'stopGeneration':
                        // User wants to stop the current generation
                        console.log('Stop generation request received');
                        if (this.currentApiAbortController) {
                            console.log('Aborting current API request');
                            this.currentApiAbortController.abort();
                            // Send a message to the webview that generation was stopped by user
                            this.sendMessageToWebview({ type: 'generationStoppedByUser' });
                        } else {
                            console.log('No active API request to abort');
                        }
                        break;

                    default:
                        console.log('Unhandled message type:', message.type);
                }
            } catch (error: any) {
                // Log the error with the message that caused it
                console.error('Error handling webview message:', message, error);

                // Show an error notification to the user
                vscode.window.showErrorMessage(`Error processing action: ${error.message || 'Unknown error'}`);

                // If this was a user query that failed, send an error message to the webview
                if (message.type === 'sendMessage') {
                    this.sendMessageToWebview({
                        type: 'geminiError',
                        text: `Error processing your request: ${error.message || 'Unknown error'}`
                    });

                    // Also send stream end to clean up UI state if needed
                    this.sendMessageToWebview({ type: 'geminiStreamEnd' });
                    this.sendMessageToWebview({ type: 'geminiFinishedThinking' });
                }
            }
        });
    }

    /**
     * Handle file search request from the webview
     */
    private async handleFileSearch(query: string) {
        console.log('handleFileSearch called with query:', query);

        try {
            console.log('Calling searchWorkspaceFiles with query:', query);
            // Search for files matching the query
            const files = await this._contextManagement.searchWorkspaceFiles(query);

            console.log('Files found:', files.length);
            console.log('First few files:', files.slice(0, 5).map(uri => uri.toString()));

            // Convert URIs to strings for display
            const fileResults = files.map(uri => ({
                path: vscode.workspace.asRelativePath(uri),
                uriString: uri.toString()
            }));

            console.log('File results prepared:', fileResults.length);

            // Send the results back to the webview
            const message = {
                type: 'fileSearchResults',
                results: fileResults
            };

            console.log('Sending fileSearchResults message to webview:', message);
            this.sendMessageToWebview(message);
        } catch (error) {
            console.error('Error searching for files:', error);
            this.sendMessageToWebview({
                type: 'fileSearchResults',
                results: [],
                error: 'Error searching for files'
            });
        }
    }

    /**
     * Handle adding a file to the context
     */
    private async handleAddFileToContext(uriString: string) {
        try {
            console.log('>>> handleAddFileToContext called with URI:', uriString);

            if (!uriString || uriString.trim() === '') {
                console.error('>>> Invalid or empty URI string provided');
                return;
            }

            // Convert the URI string back to a URI
            const uri = vscode.Uri.parse(uriString);

            // Use the centralized state management function
            const added = addUriToContext(uri);

            if (added) {
                console.log('>>> File successfully added to global context');

                // Update our local copy of the context URIs
                this._currentContextUris = getContextFileUris();
                console.log('>>> Updated local context URIs:', this._currentContextUris.map(u => u.toString()));

                // Clear conversation history when context changes
                console.log('>>> Context Change: About to clear conversation history due to adding file');
                console.log(`>>> Context Change: Before clearing, history had ${this.conversationHistory.length} messages`);
                this.clearConversationHistory();
                console.log('>>> Context Change: Conversation history cleared due to context change');

                // Send a success response back to the webview
                this.sendMessageToWebview({
                    type: 'fileAddedToContext',
                    success: true,
                    path: vscode.workspace.asRelativePath(uri)
                });
            } else {
                console.log('>>> Failed to add file to global context (already exists or invalid)');

                // Send a failure response back to the webview
                this.sendMessageToWebview({
                    type: 'fileAddedToContext',
                    success: false,
                    error: 'File already in context or invalid'
                });
            }
        } catch (error) {
            console.error('>>> Error adding file to context:', error);
            this.sendMessageToWebview({
                type: 'fileAddedToContext',
                success: false,
                error: 'Error adding file to context'
            });
        }
    }

    /**
     * Clear the conversation history
     * This should be called when the context changes
     */
    private clearConversationHistory() {
        console.log('>>> History: CLEARING conversation history!');
        console.log(`>>> History: Before clearing, history had ${this.conversationHistory.length} messages`);
        this.conversationHistory = [];
        console.log('>>> History: After clearing, history is empty');
    }

    /**
     * Clear both conversation history and context
     * This is called when starting a new chat
     */
    private async clearConversationAndContext(): Promise<void> {
        // Save the current chat before clearing it
        await this.saveCurrentChatSession();

        // Generate a new chat ID
        this.currentChatId = Date.now().toString();

        // Clear conversation history
        console.log('>>> New Chat: About to clear conversation history due to new chat button');
        console.log(`>>> New Chat: Before clearing, history had ${this.conversationHistory.length} messages`);
        this.clearConversationHistory();

        // Clear context files using the centralized state management function
        console.log('>>> New Chat: Clearing context files');
        clearContextUris();

        // Update our local copy of the context URIs
        this._currentContextUris = [];

        console.log('>>> Chat and context cleared via webview button');
    }

    /**
     * Save the current chat session to history
     */
    private async saveCurrentChatSession(): Promise<void> {
        // Only save if there are messages in the history
        if (this.conversationHistory.length > 0) {
            // Import the saveChatSession function
            const { saveChatSession } = require('./extension');

            // Generate an ID if one doesn't exist
            if (!this.currentChatId) {
                this.currentChatId = Date.now().toString();
            }

            // Get the first user message for the title
            let title = 'Chat Session';
            for (const message of this.conversationHistory) {
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
                id: this.currentChatId,
                title: title,
                timestamp: Date.now(),
                conversationHistory: this.conversationHistory,
                contextUriStrings: this._currentContextUris.map(uri => uri.toString())
            };

            // Save the session
            saveChatSession(this._context, sessionToSave);
            console.log(`Saved chat session: ${sessionToSave.id} - ${sessionToSave.title}`);
        }
    }

    /**
     * Get the current conversation history
     * @returns The current conversation history
     */
    public getCurrentHistory(): ChatMessage[] {
        return this.conversationHistory;
    }

    /**
     * Get the current context URI strings
     * @returns The current context URI strings
     */
    public getCurrentContextUriStrings(): string[] {
        return this._currentContextUris.map(uri => uri.toString());
    }

    /**
     * Get the current chat ID
     * @returns The current chat ID or null if no chat is active
     */
    public getCurrentChatId(): string | null {
        return this.currentChatId;
    }

    /**
     * Get recent files (currently open editor tabs)
     */
    private async getRecentFiles(): Promise<void> {
        try {
            console.log('Getting recent files from open editors');

            const openFiles: { label: string, uriString: string }[] = [];

            // Use tabGroups API to get open editor tabs
            for (const tabGroup of vscode.window.tabGroups.all) {
                for (const tab of tabGroup.tabs) {
                    if (tab.input instanceof vscode.TabInputText ||
                        (tab as any).input instanceof vscode.TabInputCustom) {
                        const uri = (tab.input as any).uri;
                        if (uri && uri.scheme === 'file') { // Only include file URIs
                            // Avoid duplicates
                            if (!openFiles.some(f => f.uriString === uri.toString())) {
                                openFiles.push({
                                    label: vscode.workspace.asRelativePath(uri),
                                    uriString: uri.toString()
                                });
                            }
                        }
                    }
                }
            }

            // Limit to 10 recent files
            const recentFiles = openFiles.slice(0, 10);

            console.log('Sending recent files:', recentFiles.length);

            // Send the results back to the webview
            this.sendMessageToWebview({
                type: 'fileSearchResults',
                results: recentFiles,
                isRecent: true
            });
        } catch (error) {
            console.error('Error getting recent files:', error);
            this.sendMessageToWebview({
                type: 'fileSearchResults',
                results: [],
                error: 'Error getting recent files',
                isRecent: true
            });
        }
    }

    /**
     * Show the chat history in a Quick Pick menu
     */
    private async showHistory(): Promise<void> {
        // Import the getChatHistoryList function
        const { getChatHistoryList } = require('./extension');

        // Get the list of saved chat sessions
        const historyList = getChatHistoryList(this._context);

        // Check if the list is empty
        if (!historyList || historyList.length === 0) {
            vscode.window.showInformationMessage('No saved chat history found.');
            return;
        }

        // Format the list for the Quick Pick
        const quickPickItems: vscode.QuickPickItem[] = historyList.map((session: SavedChatSession) => ({
            label: session.title,
            description: new Date(session.timestamp).toLocaleString(),
            detail: session.id
        }));

        // Show the Quick Pick
        const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select a chat session to load'
        });

        // If the user selected an item, load the chat
        if (selectedItem && selectedItem.detail) {
            console.log('User selected chat ID to load:', selectedItem.detail);
            await this.loadChatFromHistory(selectedItem.detail);
        }
    }

    /**
     * Load a chat from history
     * This method restores a previously saved chat session including its conversation history and context files
     *
     * @param chatId The ID of the chat to load
     */
    private async loadChatFromHistory(chatId: string): Promise<void> {
        // Import the necessary functions from extension.ts
        const { getChatSessionById } = require('./extension');

        // Retrieve the saved chat session by its ID
        const sessionToLoad = getChatSessionById(this._context, chatId);

        // Verify the session exists
        if (!sessionToLoad) {
            vscode.window.showErrorMessage('Could not load selected chat session.');
            return;
        }

        // Clear the current UI and state without saving the current conversation
        await this.clearUiAndStateWithoutSaving();

        // Restore the chat ID
        this.currentChatId = sessionToLoad.id;

        // Restore the conversation history
        console.log(`>>> Load History: Restoring conversation history with ${sessionToLoad.conversationHistory.length} messages`);
        this.conversationHistory = sessionToLoad.conversationHistory;
        console.log('>>> Load History: First message in restored history:',
            sessionToLoad.conversationHistory.length > 0 ?
            JSON.stringify(sessionToLoad.conversationHistory[0]) : 'No messages');
        console.log('>>> Load History: Last message in restored history:',
            sessionToLoad.conversationHistory.length > 0 ?
            JSON.stringify(sessionToLoad.conversationHistory[sessionToLoad.conversationHistory.length - 1]) : 'No messages');

        // Process each URI string from the saved session
        if (sessionToLoad.contextUriStrings && Array.isArray(sessionToLoad.contextUriStrings)) {
            console.log(`>>> Loading ${sessionToLoad.contextUriStrings.length} context files from history`);

            // Convert URI strings back to URI objects
            for (const uriString of sessionToLoad.contextUriStrings) {
                if (uriString && uriString.trim() !== '') {
                    const uri = vscode.Uri.parse(uriString);
                    // Add to the central state using our state management function
                    addUriToContext(uri);
                }
            }

            // Update our local copy after all URIs have been added
            this._currentContextUris = getContextFileUris();
            console.log(`>>> Loaded ${this._currentContextUris.length} context files from history`);
        }

        // Update the webview UI with the restored conversation history
        this.sendMessageToWebview({
            type: 'restoreChat',
            history: this.conversationHistory
        });

        // Restore the context pills in the UI
        // We need to send both the display paths and the URI strings
        const contextPaths = this._currentContextUris.map(uri => vscode.workspace.asRelativePath(uri));
        const contextUriStrings = this._currentContextUris.map(uri => uri.toString());
        this.sendMessageToWebview({
            type: 'restoreContextPills',
            contextPaths: contextPaths,
            contextUriStrings: contextUriStrings
        });

        // Show a success message to the user
        vscode.window.showInformationMessage(`Loaded chat: ${sessionToLoad.title}`);
    }

    /**
     * Clear UI and state without saving the current chat
     * Used when loading a chat from history
     */
    private async clearUiAndStateWithoutSaving(): Promise<void> {
        // Clear conversation history
        console.log('>>> Load History: About to clear conversation history before loading from history');
        console.log(`>>> Load History: Before clearing, history had ${this.conversationHistory.length} messages`);
        this.conversationHistory = [];
        console.log('>>> Load History: Conversation history cleared');

        // Clear context files using the centralized state management function
        console.log('>>> Load History: Clearing context files');
        clearContextUris();

        // Update our local copy of the context URIs
        this._currentContextUris = [];

        console.log('>>> Chat and context cleared for loading history');
    }

    /**
     * Handle removing a file from the context
     */
    private async handleRemoveFileFromContext(uriString: string) {
        try {
            console.log('>>> handleRemoveFileFromContext called with URI:', uriString);

            if (!uriString || uriString.trim() === '') {
                console.error('>>> Invalid or empty URI string provided');
                return;
            }

            // Use the centralized state management function
            const removed = removeUriFromContext(uriString);

            if (removed) {
                console.log('>>> File successfully removed from global context');

                // Update our local copy of the context URIs
                this._currentContextUris = getContextFileUris();
                console.log('>>> Updated local context URIs:', this._currentContextUris.map(u => u.toString()));

                // Clear conversation history when context changes
                console.log('>>> Context Change: About to clear conversation history due to removing file');
                console.log(`>>> Context Change: Before clearing, history had ${this.conversationHistory.length} messages`);
                this.clearConversationHistory();
                console.log('>>> Context Change: Conversation history cleared due to context change');
            } else {
                console.log('>>> Failed to remove file from global context');
            }
        } catch (error) {
            console.error('>>> Error removing file from context:', error);
        }
    }

    /**
     * Read the content of all context files
     * @returns A promise that resolves to a string containing the content of all context files
     */
    private async readContextFiles(): Promise<string> {
        // Update our local copy of the context URIs (both manual and auto)
        this._currentContextUris = getContextFileUris();

        if (this._currentContextUris.length === 0) {
            return "No context files provided.";
        }

        let combinedContent = "";

        for (const uri of this._currentContextUris) {
            try {
                // Read the file content
                const fileData = await vscode.workspace.fs.readFile(uri);

                // Convert the buffer to a string
                let fileContent = Buffer.from(fileData).toString('utf8');

                // Truncate if too long (5000 chars limit)
                const MAX_CHARS = 5000;
                if (fileContent.length > MAX_CHARS) {
                    fileContent = fileContent.substring(0, MAX_CHARS) + "\n\n... (truncated)";
                }

                // Add file marker and content to the combined content
                combinedContent += `\n\n--- File: ${vscode.workspace.asRelativePath(uri)} ---\n`;
                combinedContent += fileContent;
            } catch (error: any) {
                console.error(`Error reading file ${uri.toString()}:`, error);
                combinedContent += `\n\n--- File: ${vscode.workspace.asRelativePath(uri)} ---\n`;
                combinedContent += `Error reading file: ${error.message || 'Unknown error'}`;
            }
        }

        return combinedContent;
    }

    /**
     * Handle a user query by calling the Gemini API
     * This is the core method that processes user messages and gets AI responses
     *
     * @param userQuery The user's query text
     */
    private async handleUserQuery(userQuery: string): Promise<void> {
        // Prevent multiple concurrent requests to avoid race conditions
        if (this._isProcessingMessage) {
            console.log('Already processing a message, ignoring new request');
            return;
        }

        // Set flag to indicate we're processing a message
        this._isProcessingMessage = true;

        try {
            // Get the API key from secure storage
            const apiKey = await getApiKey(this._context);

            // If no API key is found, show an error and exit early
            if (!apiKey) {
                this.sendMessageToWebview({
                    type: 'geminiError',
                    text: 'API key not found. Please set your Gemini API key using the "Codexpilot: Set Gemini API Key" command.'
                });
                return;
            }

            // Read the content of all files in the context
            const contextContent = await this.readContextFiles();

            // Check if this query is for selection modification
            const isForSelection = !!this.activeSelectionModificationInfo;

            // Define the system message that sets the AI's behavior and tone
            let systemMessage = `You are a helpful coding assistant in an IDE. You help users understand and modify code.
Be explanatory and clear in your explanations.
When showing code examples, use proper formatting with markdown.
If the user asks about code and there's no context provided, just answer based on your general knowledge.`;

            // If this is a selection modification request, add specific instructions
            if (isForSelection) {
                systemMessage = `You are a helpful coding assistant in an IDE. You help users modify code.
IMPORTANT: The user has provided a specific code snippet selected from their editor. Modify *only* this provided code snippet based on the user's request below it.
Do not add imports or other code outside the snippet scope in the final code block; describe those separately if needed.
Always include the complete modified code in a single markdown code block with the appropriate language tag.
Be explanatory and clear in your explanations.`;
            }

            // Check if we have actual context files or just the default "no context" message
            const hasRealContext = contextContent !== "No context files provided.";

            // Generate a new chat ID if this is the first message in a new conversation
            if (this.conversationHistory.length === 0 && !this.currentChatId) {
                this.currentChatId = Date.now().toString();
                console.log(`Started new chat with ID: ${this.currentChatId}`);
            }

            // Add the user's message to the conversation history
            // For the first message with context, we include the file contents
            if (this.conversationHistory.length === 0 && hasRealContext) {
                // For the first message, include context with the user query
                this.conversationHistory.push({
                    role: 'user',
                    parts: [{
                        text: `CONTEXT FILES:\n${contextContent}\n\nUSER QUERY:\n${userQuery}`
                    }]
                });
                console.log(`>>> History: Added USER message with context. History length: ${this.conversationHistory.length}`,
                    this.conversationHistory.slice(-5)); // Log last 5 items
            } else {
                // For subsequent messages, just add the user query
                this.conversationHistory.push({
                    role: 'user',
                    parts: [{ text: userQuery }]
                });
                console.log(`>>> History: Added USER message. History length: ${this.conversationHistory.length}`,
                    this.conversationHistory.slice(-5)); // Log last 5 items
            }

            // Update UI to show the AI is thinking
            this.sendMessageToWebview({ type: 'geminiThinking' });

            // Prepare the UI for streaming response
            this.sendMessageToWebview({ type: 'geminiStreamStart' });

            // Variable to accumulate the complete response for conversation history
            let completeResponseText = '';

            // Prepare the history for the API call
            const historyForApi = this.conversationHistory.slice(-this.MAX_HISTORY_LENGTH);

            console.log(`>>> History: Preparing API call. Sending ${historyForApi.length} turns.`);

            // Log the first turn if history exists
            if (historyForApi.length > 1) {
                console.log('>>> History: First turn being sent:', JSON.stringify(historyForApi[0]));
            }

            // Log the last turn being sent for verification
            console.log('>>> History: Last turn being sent:', JSON.stringify(historyForApi.slice(-1)[0]));

            // Cancel any previous, potentially lingering controller
            if (this.currentApiAbortController) {
                console.log('Cancelling previous API request');
                this.currentApiAbortController.abort();
                this.currentApiAbortController = null;
            }

            // Create a new AbortController for this request
            this.currentApiAbortController = new AbortController();

            try {
                // Call the Gemini API with streaming enabled
                // This sends the conversation history and system message to the API
                // and processes the response in chunks for a better user experience
                await callGeminiApiStream(
                    apiKey,
                    historyForApi, // Use the prepared history
                    systemMessage,
                    (chunk: string) => {
                        // Accumulate the complete response
                        completeResponseText += chunk;

                        // Send each chunk to the webview for real-time display
                        this.sendMessageToWebview({
                            type: 'geminiResponseChunk',
                            chunk: chunk
                        });
                    },
                    this.currentApiAbortController.signal // Pass the abort signal
                );
            } finally {
                // Clear the controller reference
                this.currentApiAbortController = null;
            }

            // Add the assistant's complete response to the conversation history
            this.conversationHistory.push({
                role: 'model',
                parts: [{ text: completeResponseText }]
            });
            console.log(`>>> History: Added MODEL message. History length: ${this.conversationHistory.length}`,
                this.conversationHistory.slice(-5)); // Log last 5 items

            // Trim history if it exceeds the maximum length to manage token usage
            if (this.conversationHistory.length > this.MAX_HISTORY_LENGTH) {
                console.log(`>>> History: Trimming history from ${this.conversationHistory.length} to ${this.MAX_HISTORY_LENGTH}`);
                this.conversationHistory = this.conversationHistory.slice(-this.MAX_HISTORY_LENGTH);
                console.log(`>>> History: After trimming, history length: ${this.conversationHistory.length}`,
                    this.conversationHistory.slice(-5)); // Log last 5 items
            }

            console.log(`Conversation history now has ${this.conversationHistory.length} messages`);

            // Signal the webview that the stream has ended
            // Include the isSelectionModification flag if this was a selection modification request
            // Include stoppedByUser=false to indicate normal completion
            this.sendMessageToWebview({
                type: 'geminiStreamEnd',
                isSelectionModification: isForSelection,
                stoppedByUser: false
            });

        } catch (error: any) {
            // Log and handle any errors that occur during processing
            console.error('Error handling user query:', error);

            // Check if this was an abort error (user stopped generation)
            const isAbortError = error.name === 'AbortError' || error.message?.includes('aborted');

            if (isAbortError) {
                console.log('API call aborted by user action.');

                // Send stream end WITH the stoppedByUser flag
                this.sendMessageToWebview({
                    type: 'geminiStreamEnd',
                    stoppedByUser: true
                });
            } else {
                // Send the error message to the webview for other errors
                this.sendMessageToWebview({
                    type: 'geminiError',
                    text: error.message || 'An unknown error occurred'
                });

                // Also send stream end to clean up UI state if needed (not stopped by user)
                this.sendMessageToWebview({
                    type: 'geminiStreamEnd',
                    stoppedByUser: false
                });
            }
        } finally {
            // Always reset the processing flag when done
            this._isProcessingMessage = false;

            // Notify the webview that processing is complete
            this.sendMessageToWebview({ type: 'geminiFinishedThinking' });
        }
    }

    /**
     * Handle inserting code into the active editor
     * @param code The code to insert
     */
    private async handleInsertCode(code: string): Promise<void> {
        // Get the active text editor
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            // No active editor, show a warning
            vscode.window.showWarningMessage('No active editor found to insert code into.');
            return;
        }

        try {
            // Get the current cursor position
            const position = editor.selection.active;

            // Insert the code at the cursor position
            await editor.edit(editBuilder => {
                editBuilder.insert(position, code);
            });

            // Show a success message
            vscode.window.showInformationMessage('Code inserted at cursor position.');
        } catch (error) {
            console.error('Error inserting code:', error);
            vscode.window.showErrorMessage('Failed to insert code: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    /**
     * Handle getting information about the active text selection
     * This is called when the user clicks the "Modify Selection" button
     */
    private async handleGetActiveSelectionInfo(): Promise<void> {
        // Get the active text editor
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            // No active editor, show a warning
            vscode.window.showWarningMessage('No active editor found. Please open a file and select some code first.');
            return;
        }

        // Check if there is a selection
        if (editor.selection.isEmpty) {
            vscode.window.showWarningMessage('No code selected. Please select some code first.');
            return;
        }

        try {
            // Get the selection range
            const selectionRange = editor.selection;

            // Get the selected text
            const selectedText = editor.document.getText(selectionRange);

            // Get the document URI
            const documentUri = editor.document.uri;

            // Get the language ID
            const languageId = editor.document.languageId;

            // Store the selection info for later use
            this.activeSelectionModificationInfo = {
                documentUri,
                selectionRange,
                originalSelectedText: selectedText
            };

            // Send the selection info to the webview
            this.sendMessageToWebview({
                type: 'populateModificationInput',
                selectedText,
                languageId
            });

            console.log('Sent selection info to webview:', {
                textLength: selectedText.length,
                languageId,
                uri: documentUri.toString()
            });
        } catch (error) {
            console.error('Error getting selection info:', error);
            vscode.window.showErrorMessage('Failed to get selection info: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }

    /**
     * Handle applying a code modification to the active selection
     * @param suggestedCode The modified code to apply to the selection
     */
    private async handleApplySelectionModification(suggestedCode: string): Promise<void> {
        // Check if we have stored selection info
        if (!this.activeSelectionModificationInfo) {
            vscode.window.showErrorMessage('Original selection information not found. Please try selecting the code again.');
            return;
        }

        try {
            const { documentUri, selectionRange } = this.activeSelectionModificationInfo;

            // Create a workspace edit
            const edit = new vscode.WorkspaceEdit();

            // Replace the selected text with the suggested code
            edit.replace(documentUri, selectionRange, suggestedCode);

            // Apply the edit
            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                // Show a success message
                vscode.window.showInformationMessage('Code modification applied successfully.');

                // Try to format the document if possible
                try {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && editor.document.uri.toString() === documentUri.toString()) {
                        await vscode.commands.executeCommand('editor.action.formatDocument');
                    }
                } catch (formatError) {
                    console.log('Format after modification failed (non-critical):', formatError);
                }

                // Send a success message back to the webview with the applied code
                // This allows the webview to find and update the corresponding button
                this.sendMessageToWebview({
                    type: 'applyModificationSucceeded',
                    appliedCode: suggestedCode
                });

                // Clear the stored selection info after sending the success message
                this.activeSelectionModificationInfo = undefined;
            } else {
                vscode.window.showErrorMessage('Failed to apply code modification.');

                // Clear the stored selection info even on failure
                this.activeSelectionModificationInfo = undefined;
            }
        } catch (error) {
            console.error('Error applying code modification:', error);
            vscode.window.showErrorMessage('Failed to apply code modification: ' + (error instanceof Error ? error.message : 'Unknown error'));

            // Clear the stored selection info even on error
            this.activeSelectionModificationInfo = undefined;
        }
    }

    /**
     * Send a context update to the webview
     * This method sends the current context URIs to the webview for UI synchronization
     */
    private sendContextUpdateToWebview(): void {
        // Get the current context URIs (both manual and auto)
        this._currentContextUris = getContextFileUris();

        // Prepare the context items with isCurrent flag
        const contextItems = [];

        // Get the current auto context URI if it exists
        const currentAutoContextUri = vscode.window.activeTextEditor?.document?.uri;
        const currentAutoContextUriString = currentAutoContextUri?.toString();

        // Process each URI
        for (const uri of this._currentContextUris) {
            const uriString = uri.toString();
            const path = vscode.workspace.asRelativePath(uri);

            // Check if this is the current auto context URI
            const isCurrent = currentAutoContextUriString === uriString;

            contextItems.push({
                path,
                uriString,
                isCurrent
            });
        }

        // Also prepare the legacy format data for backward compatibility
        const contextPaths = contextItems.map(item => item.path);
        const contextUriStrings = contextItems.map(item => item.uriString);

        // Send the update to the webview
        this.sendMessageToWebview({
            type: 'updateContextPills',
            contextPaths: contextPaths,
            contextUriStrings: contextUriStrings,
            contextItems: contextItems
        });

        console.log(`>>> Sent context update to webview with ${contextItems.length} files`);
    }

    /**
     * Send a message to the webview
     */
    public sendMessageToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Generate a nonce to use for inline script security
        const nonce = this._getNonce();

        // Create URIs for the stylesheets and scripts
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

        // Create URI for the Codicon font file (pointing to our copied version in dist/media)
        const codiconFontUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'codicon.ttf')
        );

        // Create URI for the Codicon CSS file
        const codiconCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'codicon.css')
        );

        // Create URI for our custom Codicon CSS file
        const codiconCustomCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'media', 'codicon-custom.css')
        );

        // Log for debugging during development
        console.log("[Codicon Debug] Copied Font URI:", codiconFontUri.toString());
        console.log("[Codicon Debug] Copied CSS URI:", codiconCssUri.toString());
        console.log("[Codicon Debug] Custom CSS URI:", codiconCustomCssUri.toString());

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; font-src ${webview.cspSource} data:; connect-src https://generativelanguage.googleapis.com;">
            <title>Codexpilot Chat</title>
            <!-- Inline style for Codicon font path variable -->
            <style nonce="${nonce}">
                :root {
                    --vscode-codicon-font-path: url('${codiconFontUri.toString()}');
                }
            </style>
            <link rel="stylesheet" type="text/css" href="${styleUri}">
            <link rel="stylesheet" href="${codiconCssUri}">
            <link rel="stylesheet" href="${codiconCustomCssUri}">
            <!-- Highlight.js styles are included in main.css -->
            <style nonce="${nonce}">
                /* Custom styles for our UI elements */
                .code-button .codicon {
                    font-size: 14px;
                    line-height: 1;
                }

                #mode-picker-button .codicon {
                    font-size: 12px;
                }

                #send-button .codicon {
                    font-size: 12px;
                }

                #context-add-button .codicon {
                    font-size: 14px;
                }

                .soon-tag {
                    font-size: 0.8em;
                    opacity: 0.7;
                    margin-left: 4px;
                }
            </style>
        </head>
        <body>
            <header id="view-header">
                <div id="view-title">
                    <span class="codicon codicon-beaker" style="margin-right: 5px;"></span>
                    Codexpilot
                </div>
                <div id="header-actions">
                    <button class="icon-button" id="new-chat-button" title="Start New Chat">
                        <span class="codicon codicon-add"></span>
                    </button>
                    <button class="icon-button" id="history-button" title="Chat History (Coming Soon)">
                        <span class="codicon codicon-history"></span>
                    </button>
                    <button class="icon-button" id="settings-button" title="Settings (Coming Soon)">
                        <span class="codicon codicon-settings-gear"></span>
                    </button>
                </div>
            </header>
            <div id="webview-container">
                <div id="chat-history">
                    <!-- Chat messages will appear here -->
                    <div class="welcome-message">
                        <h2>Welcome to Codexpilot!</h2>
                        <p>Add files to the context by typing @ followed by a filename</p>
                    </div>
                </div>
                <div id="input-area">
                    <!-- Context Pills Container -->
                    <div id="context-pills">
                        <!-- Context file pills will be added here dynamically -->
                    </div>

                    <!-- Textarea for user input -->
                    <div class="input-container">
                        <textarea id="user-input" placeholder="Ask Codexpilot..."></textarea>
                    </div>

                    <!-- Action buttons row inside the main input area -->
                    <div id="action-button-row">
                        <div id="action-buttons-left">
                            <!-- Mode Picker Button -->
                            <div id="mode-picker-container">
                                <button id="mode-picker-button" class="mode-button" title="Select Mode">
                                    <i class="codicon codicon-comment-discussion"></i>
                                    <span id="current-mode-text">Chat</span>
                                    <i class="codicon codicon-chevron-down"></i>
                                </button>
                                <!-- Dropdown menu - initially hidden -->
                                <ul id="mode-dropdown" class="mode-dropdown">
                                    <li><button data-mode="chat"><i class="codicon codicon-comment-discussion"></i> Chat</button></li>
                                    <li><button data-mode="agent" title="Coming Soon!"><i class="codicon codicon-robot"></i> Agent <span class="soon-tag">Soon</span></button></li>
                                </ul>
                            </div>
                            <!-- Context Add Button -->
                            <button id="context-add-button" title="Add File Context">
                                <i class="codicon codicon-mention"></i>
                            </button>
                            <!-- Modify Selection Button -->
                            <button id="modify-selection-button" title="Modify Selected Code">
                                <i class="codicon codicon-wand"></i>
                            </button>
                        </div>
                        <div id="action-buttons-right">
                            <!-- Send Button -->
                            <button id="send-button" title="Send Message">
                                <i class="codicon codicon-send"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/markdown-it/13.0.1/markdown-it.min.js"></script>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
            <!-- Add common language support -->
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/languages/javascript.min.js"></script>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/languages/typescript.min.js"></script>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/languages/python.min.js"></script>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/languages/java.min.js"></script>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/languages/csharp.min.js"></script>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/languages/xml.min.js"></script>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/languages/css.min.js"></script>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/languages/json.min.js"></script>
            <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/languages/bash.min.js"></script>
            <script nonce="${nonce}">
                // Initialize highlight.js
                hljs.configure({
                    languages: ['javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp', 'html', 'css', 'xml', 'json', 'markdown', 'bash']
                });

                // Log to confirm libraries are loaded
                console.log('markdown-it loaded:', typeof window.markdownit === 'function');
                console.log('highlight.js loaded:', typeof window.hljs === 'object');

                // Register a global function to manually highlight all code blocks
                window.highlightAllCodeBlocks = function() {
                    console.log('Manually highlighting all code blocks');
                    document.querySelectorAll('pre code').forEach(block => {
                        hljs.highlightElement(block);
                    });
                };
            </script>

            <!-- Make font path available globally for debugging -->
            <script nonce="${nonce}">
                // Make font path available globally for main.js and debugging
                window.codiconFontPath = '${codiconFontUri.toString()}';
                console.log('Font Path set on window:', window.codiconFontPath);
            </script>

            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }

    /**
     * Generate a nonce string (random value for security)
     */
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
import * as vscode from 'vscode';
import { callGeminiApiStream } from './geminiApi';
import { getApiKey, getContextFileUris } from './extension';
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

    // Conversation history for Gemini API
    private conversationHistory: ChatMessage[] = [];
    private readonly MAX_HISTORY_LENGTH = 20; // Keep last 20 messages (10 turns)

    // Current chat ID
    private currentChatId: string | null = null;

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

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Enable JavaScript in the webview
            enableScripts: true,
            // Restrict the webview to only load resources from the extension's directory
            localResourceRoots: [this._extensionUri]
        };

        // Set the HTML content
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log('Received message from webview:', message);

            switch (message.type) {
                case 'sendMessage':
                    console.log('User message:', message.text);
                    await this.handleUserQuery(message.text);
                    break;

                case 'searchWorkspaceFiles':
                    console.log('Received searchWorkspaceFiles request with query:', message.query);
                    await this.handleFileSearch(message.query);
                    break;

                case 'addFileToContextViaMention':
                    console.log('Received addFileToContextViaMention request with URI:', message.uriString);
                    await this.handleAddFileToContext(message.uriString);
                    break;

                case 'insertCode':
                    console.log('Received insertCode request with code length:', message.code.length);
                    await this.handleInsertCode(message.code);
                    break;

                case 'removeFileFromContext':
                    console.log('Received removeFileFromContext request with URI:', message.uriString);
                    await this.handleRemoveFileFromContext(message.uriString);
                    break;

                case 'clearChat':
                    console.log('Received clearChat request');
                    await this.clearConversationAndContext();
                    break;

                case 'showInfoMessage':
                    console.log('Received showInfoMessage request:', message.text);
                    vscode.window.showInformationMessage(message.text);
                    break;

                case 'showHistory':
                    console.log('Received showHistory request');
                    await this.showHistory();
                    break;

                case 'getRecentFiles':
                    console.log('Received getRecentFiles request');
                    await this.getRecentFiles();
                    break;

                default:
                    console.log('Unhandled message type:', message.type);
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
            // Convert the URI string back to a URI
            const uri = vscode.Uri.parse(uriString);

            // Add the file to the context
            const added = await this._contextManagement.addFileToContext(uri);

            // Update our local copy of the context URIs
            this._currentContextUris = getContextFileUris();

            // Clear conversation history when context changes
            this.clearConversationHistory();

            // Send a response back to the webview
            this.sendMessageToWebview({
                type: 'fileAddedToContext',
                success: added,
                path: added ? vscode.workspace.asRelativePath(uri) : null
            });
        } catch (error) {
            console.error('Error adding file to context:', error);
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
        console.log('Clearing conversation history');
        this.conversationHistory = [];
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
        this.clearConversationHistory();

        // Clear context files
        this._currentContextUris = [];

        // Call the clearContext command to clear the global context state
        await vscode.commands.executeCommand('codexpilot.clearContext');

        console.log('Chat and context cleared via webview button');
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
     * @param chatId The ID of the chat to load
     */
    private async loadChatFromHistory(chatId: string): Promise<void> {
        // Import the getChatSessionById function
        const { getChatSessionById, setActiveContextUris } = require('./extension');

        // Get the chat session
        const sessionToLoad = getChatSessionById(this._context, chatId);

        // Check if the session exists
        if (!sessionToLoad) {
            vscode.window.showErrorMessage('Could not load selected chat session.');
            return;
        }

        // Clear the current state without saving
        await this.clearUiAndStateWithoutSaving();

        // Set the chat ID
        this.currentChatId = sessionToLoad.id;

        // Load the conversation history
        this.conversationHistory = sessionToLoad.conversationHistory;

        // Load the context URIs
        this._currentContextUris = sessionToLoad.contextUriStrings.map((uriString: string) => vscode.Uri.parse(uriString));

        // Update the context file list in extension.ts
        setActiveContextUris(this._currentContextUris);

        // Update the webview UI
        this.sendMessageToWebview({
            type: 'restoreChat',
            history: this.conversationHistory
        });

        // Send paths for pills
        const contextPaths = this._currentContextUris.map(uri => vscode.workspace.asRelativePath(uri));
        this.sendMessageToWebview({
            type: 'restoreContextPills',
            contextPaths: contextPaths,
            contextUriStrings: sessionToLoad.contextUriStrings
        });

        // Show success message
        vscode.window.showInformationMessage(`Loaded chat: ${sessionToLoad.title}`);
    }

    /**
     * Clear UI and state without saving the current chat
     * Used when loading a chat from history
     */
    private async clearUiAndStateWithoutSaving(): Promise<void> {
        // Clear conversation history
        this.conversationHistory = [];

        // Clear context files
        this._currentContextUris = [];

        // Call the clearContext command to clear the global context state
        await vscode.commands.executeCommand('codexpilot.clearContext');

        console.log('Chat and context cleared for loading history');
    }

    /**
     * Handle removing a file from the context
     */
    private async handleRemoveFileFromContext(uriString: string) {
        try {
            // Convert the URI string back to a URI
            const uri = vscode.Uri.parse(uriString);

            // Get the current context URIs from extension.ts
            const currentUris = getContextFileUris();

            // Find the URI to remove
            const uriToRemove = currentUris.find(u => u.toString() === uriString);

            if (uriToRemove) {
                // Import the removeFileFromContext function from extension.ts
                const { removeFileFromContext } = require('./extension');

                // Remove the file from the context
                await removeFileFromContext(uriToRemove);

                // Update our local copy of the context URIs
                this._currentContextUris = getContextFileUris();

                // Clear conversation history when context changes
                this.clearConversationHistory();

                console.log('File removed from context:', vscode.workspace.asRelativePath(uri));
            } else {
                console.log('URI not found in context:', uriString);
            }
        } catch (error) {
            console.error('Error removing file from context:', error);
        }
    }

    /**
     * Read the content of all context files
     * @returns A promise that resolves to a string containing the content of all context files
     */
    private async readContextFiles(): Promise<string> {
        // Update our local copy of the context URIs
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
     * @param userQuery The user's query text
     */
    private async handleUserQuery(userQuery: string): Promise<void> {
        // Prevent multiple concurrent requests
        if (this._isProcessingMessage) {
            console.log('Already processing a message, ignoring new request');
            return;
        }

        this._isProcessingMessage = true;

        try {
            // Get the API key
            const apiKey = await getApiKey(this._context);

            if (!apiKey) {
                this.sendMessageToWebview({
                    type: 'geminiError',
                    text: 'API key not found. Please set your Gemini API key using the "Codexpilot: Set Gemini API Key" command.'
                });
                return;
            }

            // Get the context content
            const contextContent = await this.readContextFiles();

            // Construct the system message
            const systemMessage = `You are a helpful coding assistant in an IDE. You help users understand and modify code.
Be explanatory and clear in your explanations.
When showing code examples, use proper formatting with markdown.
If the user asks about code and there's no context provided, just answer based on your general knowledge.`;

            // Determine if we have actual context files or just the default message
            const hasRealContext = contextContent !== "No context files provided.";

            // If this is the first message in a new chat, generate a chat ID
            if (this.conversationHistory.length === 0 && !this.currentChatId) {
                this.currentChatId = Date.now().toString();
                console.log(`Started new chat with ID: ${this.currentChatId}`);
            }

            // Add the user's message to the conversation history
            // If this is the first message and we have context, include the context in the message
            if (this.conversationHistory.length === 0 && hasRealContext) {
                // For the first message, include context with the user query
                this.conversationHistory.push({
                    role: 'user',
                    parts: [{
                        text: `CONTEXT FILES:\n${contextContent}\n\nUSER QUERY:\n${userQuery}`
                    }]
                });
            } else {
                // For subsequent messages, just add the user query
                this.conversationHistory.push({
                    role: 'user',
                    parts: [{ text: userQuery }]
                });
            }

            // Send a thinking indicator
            this.sendMessageToWebview({ type: 'geminiThinking' });

            // Send a message to prepare the UI for streaming
            this.sendMessageToWebview({ type: 'geminiStreamStart' });

            // Create a variable to accumulate the complete response
            let completeResponseText = '';

            // Call the Gemini API with streaming and conversation history
            await callGeminiApiStream(
                apiKey,
                this.conversationHistory,
                systemMessage,
                (chunk: string) => {
                    // Accumulate the complete response
                    completeResponseText += chunk;

                    // Send each chunk to the webview
                    this.sendMessageToWebview({
                        type: 'geminiResponseChunk',
                        chunk: chunk
                    });
                }
            );

            // Add the assistant's response to the conversation history
            this.conversationHistory.push({
                role: 'model',
                parts: [{ text: completeResponseText }]
            });

            // Trim history if it exceeds the maximum length
            if (this.conversationHistory.length > this.MAX_HISTORY_LENGTH) {
                this.conversationHistory = this.conversationHistory.slice(-this.MAX_HISTORY_LENGTH);
            }

            console.log(`Conversation history now has ${this.conversationHistory.length} messages`);

            // Send a message to indicate the stream has ended
            this.sendMessageToWebview({ type: 'geminiStreamEnd' });

        } catch (error: any) {
            console.error('Error handling user query:', error);

            // Send the error
            this.sendMessageToWebview({
                type: 'geminiError',
                text: error.message || 'An unknown error occurred'
            });

            // Also send stream end to clean up UI state if needed
            this.sendMessageToWebview({ type: 'geminiStreamEnd' });
        } finally {
            // Reset the processing flag
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

        // Create URI for the VS Code Codicons CSS
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} https://cdnjs.cloudflare.com 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; font-src ${webview.cspSource} https://cdnjs.cloudflare.com;">
            <title>Codexpilot Chat</title>
            <link rel="stylesheet" type="text/css" href="${styleUri}">
            <link rel="stylesheet" href="${codiconsUri}">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/vs2015.min.css">
            <style>
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
                    <textarea id="user-input" placeholder="Ask Codexpilot..."></textarea>

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
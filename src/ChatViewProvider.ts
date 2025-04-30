import * as vscode from 'vscode';
import { callGeminiApi, callGeminiApiStream } from './geminiApi';
import { getApiKey, getContextFileUris } from './extension';

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

            // Construct the full prompt
            const systemMessage = `You are a helpful coding assistant in an IDE. You help users understand and modify code.
Be explanatory and clear in your explanations.
When showing code examples, use proper formatting with markdown.
If the user asks about code and there's no context provided, just answer based on your general knowledge.`;

            // Determine if we have actual context files or just the default message
            const hasRealContext = contextContent !== "No context files provided.";

            // Construct the prompt differently based on whether we have context
            const fullPrompt = hasRealContext
                ? `${systemMessage}

CONTEXT FILES:
${contextContent}

USER QUERY:
${userQuery}`
                : `${systemMessage}

USER QUERY:
${userQuery}`;

            // Send a thinking indicator
            this.sendMessageToWebview({ type: 'geminiThinking' });

            // Send a message to prepare the UI for streaming
            this.sendMessageToWebview({ type: 'geminiStreamStart' });

            // Call the Gemini API with streaming
            await callGeminiApiStream(
                apiKey,
                fullPrompt,
                (chunk) => {
                    // Send each chunk to the webview
                    this.sendMessageToWebview({
                        type: 'geminiResponseChunk',
                        chunk: chunk
                    });
                }
            );

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

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} https://cdnjs.cloudflare.com 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; font-src https://cdnjs.cloudflare.com;">
            <title>Codexpilot Chat</title>
            <link rel="stylesheet" type="text/css" href="${styleUri}">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/vs2015.min.css">
            <style>
                /* VS Code Codicon styles */
                .codicon {
                    font-family: 'codicon';
                    font-size: 16px;
                    font-style: normal;
                    font-weight: normal;
                    display: inline-block;
                    text-decoration: none;
                    text-rendering: auto;
                    text-align: center;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                    user-select: none;
                    -webkit-user-select: none;
                }

                /* Codicon icons */
                .codicon-send:before { content: '\\ea77'; }
                .codicon-copy:before { content: '\\eb03'; }
                .codicon-insert:before { content: '\\ea7a'; }
                .codicon-add:before { content: '\\ea60'; }
                .codicon-check:before { content: '\\eab2'; }
                .codicon-error:before { content: '\\ea87'; }
                .codicon-loading:before { content: '\\eb19'; }
                .codicon-comment-discussion:before { content: '\\ea90'; }
                .codicon-chevron-down:before { content: '\\eab4'; }
                .codicon-robot:before { content: '\\eb70'; }
                .codicon-mention:before { content: '\\eba3'; }

                /* Fallback if codicon font is not available */
                @font-face {
                    font-family: 'codicon';
                    src: url('${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'codicon.ttf'))}');
                }

                /* Fallback content for icons */
                .codicon-send:not(:before) { content: '→'; }
                .codicon-copy:not(:before) { content: 'C'; }
                .codicon-insert:not(:before) { content: 'I'; }
                .codicon-add:not(:before) { content: '+'; }
                .codicon-check:not(:before) { content: '✓'; }
                .codicon-error:not(:before) { content: '!'; }
                .codicon-loading:not(:before) { content: '⟳'; }
                .codicon-comment-discussion:not(:before) { content: '💬'; }
                .codicon-chevron-down:not(:before) { content: '▼'; }
                .codicon-robot:not(:before) { content: '🤖'; }
                .codicon-mention:not(:before) { content: '@'; }
            </style>
        </head>
        <body>
            <div id="webview-container">
                <div id="chat-history">
                    <!-- Chat messages will appear here -->
                    <div class="welcome-message">
                        <h2>Welcome to Codexpilot!</h2>
                        <p>Add files to the context by typing @ followed by a filename (e.g., @main.js).</p>
                    </div>
                </div>
                <div id="input-area">
                    <div id="input-wrapper">
                        <div id="context-pills">
                            <!-- Context file pills will be added here dynamically -->
                        </div>
                        <textarea id="user-input" placeholder="Ask Codexpilot... (Use @ to add files to context)"></textarea>
                        <button id="send-button" title="Send Message">
                            <i class="codicon codicon-send"></i>
                        </button>

                        <!-- Mode Picker Dropdown -->
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
                        <button id="context-add-button" class="icon-button" title="Add Context File (@)">
                            <i class="codicon codicon-mention"></i>
                        </button>
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
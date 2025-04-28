import * as vscode from 'vscode';
import { callGeminiApi } from './geminiApi';
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
            const systemMessage = `You are a helpful coding assistant. You help users understand and modify code.
Be concise and clear in your explanations. If you're not sure about something, say so.
When showing code examples, use proper formatting.`;

            const fullPrompt = `${systemMessage}

CONTEXT FILES:
${contextContent}

USER QUERY:
${userQuery}`;

            // Send a thinking indicator
            this.sendMessageToWebview({ type: 'geminiThinking' });

            // Call the Gemini API
            const responseText = await callGeminiApi(apiKey, fullPrompt);

            // Send the response
            this.sendMessageToWebview({
                type: 'geminiResponse',
                text: responseText
            });
        } catch (error: any) {
            console.error('Error handling user query:', error);

            // Send the error
            this.sendMessageToWebview({
                type: 'geminiError',
                text: error.message || 'An unknown error occurred'
            });
        } finally {
            // Reset the processing flag
            this._isProcessingMessage = false;

            // Notify the webview that processing is complete
            this.sendMessageToWebview({ type: 'geminiFinishedThinking' });
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
        </head>
        <body>
            <div id="webview-container">
                <div id="context-files">
                    <h3>Context Files</h3>
                    <div id="context-files-list">
                        <!-- Context files will be listed here -->
                        <p>No files added to context yet.</p>
                    </div>
                </div>
                <div id="chat-history">
                    <!-- Chat messages will appear here -->
                    <div class="welcome-message">
                        <h2>Welcome to Codexpilot!</h2>
                        <p>Add files to the context using the command palette and start chatting.</p>
                    </div>
                </div>
                <div id="input-area">
                    <textarea id="user-input" placeholder="Ask Codexpilot..."></textarea>
                    <button id="send-button">Send</button>
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
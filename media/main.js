// Codexpilot JavaScript

(function() {
    // Get VS Code API
    const vscode = acquireVsCodeApi();

    // DOM Elements
    const contextFilesElement = document.getElementById('context-files');
    const contextFilesList = document.getElementById('context-files-list');
    const chatHistoryElement = document.getElementById('chat-history');
    const userInputElement = document.getElementById('user-input');
    const sendButtonElement = document.getElementById('send-button');

    // Initialize state
    let contextFiles = [];
    let chatHistory = [];

    // Event listeners
    sendButtonElement.addEventListener('click', sendMessage);
    userInputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.type) {
            case 'updateContextFiles':
                updateContextFiles(message.files);
                break;
            case 'addChatMessage':
                addChatMessage(message.sender, message.text);
                break;
            case 'assistantResponse':
                addChatMessage('assistant', message.text);
                break;
            case 'clearChat':
                clearChat();
                break;
        }
    });

    // Functions
    function sendMessage() {
        const text = userInputElement.value.trim();
        if (text) {
            // Add message to UI
            addChatMessage('user', text);

            // Send message to extension
            vscode.postMessage({
                type: 'sendMessage',
                text: text
            });

            // Clear input
            userInputElement.value = '';
        }
    }

    function addChatMessage(sender, text) {
        // Remove welcome message if it exists
        const welcomeMessage = chatHistoryElement.querySelector('.welcome-message');
        if (welcomeMessage) {
            chatHistoryElement.removeChild(welcomeMessage);
        }

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;

        const senderElement = document.createElement('div');
        senderElement.className = 'message-sender';
        senderElement.textContent = sender === 'user' ? 'You' : 'Assistant';

        const textElement = document.createElement('div');
        textElement.className = 'message-text';
        textElement.textContent = text;

        messageElement.appendChild(senderElement);
        messageElement.appendChild(textElement);

        chatHistoryElement.appendChild(messageElement);

        // Add to chat history
        chatHistory.push({
            sender: sender,
            text: text
        });

        // Scroll to bottom
        chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;

        // Save state
        saveState();
    }

    function updateContextFiles(files) {
        contextFiles = files;

        if (files.length === 0) {
            contextFilesList.innerHTML = '<p>No files added to context yet.</p>';
        } else {
            contextFilesList.innerHTML = '';
            const list = document.createElement('ul');

            files.forEach(file => {
                const item = document.createElement('li');
                item.textContent = file;
                list.appendChild(item);
            });

            contextFilesList.appendChild(list);
        }
    }

    function clearChat() {
        // Remove all messages
        chatHistoryElement.innerHTML = '';

        // Add welcome message back
        const welcomeMessage = document.createElement('div');
        welcomeMessage.className = 'welcome-message';
        welcomeMessage.innerHTML = `
            <h2>Welcome to Codexpilot!</h2>
            <p>Add files to the context using the command palette and start chatting.</p>
        `;
        chatHistoryElement.appendChild(welcomeMessage);

        // Clear chat history
        chatHistory = [];

        // Save state
        saveState();
    }

    // Initialize state persistence
    function saveState() {
        vscode.setState({
            contextFiles: contextFiles,
            chatHistory: chatHistory
        });
    }

    function loadState() {
        const state = vscode.getState();
        if (state) {
            // Restore context files
            if (state.contextFiles && state.contextFiles.length > 0) {
                updateContextFiles(state.contextFiles);
            }

            // Restore chat history
            if (state.chatHistory && state.chatHistory.length > 0) {
                // Clear welcome message
                chatHistoryElement.innerHTML = '';

                // Add each message
                state.chatHistory.forEach(msg => {
                    addChatMessage(msg.sender, msg.text);
                });
            }
        }
    }

    // Load state when webview is initialized
    loadState();
})();
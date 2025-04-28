// Codexpilot JavaScript

(function() {
    // Get VS Code API
    const vscode = acquireVsCodeApi();

    // DOM Elements
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const chatMessages = document.getElementById('chat-messages');
    const contextFilesList = document.getElementById('context-files-list');

    // Initialize state
    let contextFiles = [];

    // Event listeners
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => {
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
            case 'clearChat':
                clearChat();
                break;
        }
    });

    // Functions
    function sendMessage() {
        const text = messageInput.value.trim();
        if (text) {
            // Add message to UI
            addChatMessage('user', text);

            // Send message to extension
            vscode.postMessage({
                type: 'sendMessage',
                text: text
            });

            // Clear input
            messageInput.value = '';
        }
    }

    function addChatMessage(sender, text) {
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

        chatMessages.appendChild(messageElement);

        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function updateContextFiles(files) {
        contextFiles = files;

        if (files.length === 0) {
            contextFilesList.innerHTML = '<p>No files added to context yet.</p>';
        } else {
            contextFilesList.innerHTML = '';
            const list = document.createElement('ul');
            list.style.margin = '0';
            list.style.paddingLeft = '20px';

            files.forEach(file => {
                const item = document.createElement('li');
                item.textContent = file;
                list.appendChild(item);
            });

            contextFilesList.appendChild(list);
        }
    }

    function clearChat() {
        // Remove all messages except the welcome message
        while (chatMessages.firstChild && !chatMessages.firstChild.classList.contains('welcome-message')) {
            chatMessages.removeChild(chatMessages.firstChild);
        }
    }
})();
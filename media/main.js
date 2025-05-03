// Codexpilot JavaScript

(function() {
    // Get VS Code API
    const vscode = acquireVsCodeApi();

    // DOM Elements
    const chatHistoryElement = document.getElementById('chat-history');
    const userInputElement = document.getElementById('user-input');
    const sendButtonElement = document.getElementById('send-button');
    const contextPillsElement = document.getElementById('context-pills');
    const modePickerButton = document.getElementById('mode-picker-button');
    const modeDropdown = document.getElementById('mode-dropdown');
    const contextAddButton = document.getElementById('context-add-button');
    const newChatButton = document.getElementById('new-chat-button');
    const historyButton = document.getElementById('history-button');
    const settingsButton = document.getElementById('settings-button');

    // Create file search results container
    const fileSearchContainer = document.createElement('div');
    fileSearchContainer.id = 'file-search-container';
    fileSearchContainer.className = 'file-search-container';
    fileSearchContainer.style.display = 'none';
    document.getElementById('input-area').appendChild(fileSearchContainer);

    // Initialize state
    let contextFiles = [];
    let chatHistory = [];
    let isSearching = false;
    let currentSearchQuery = '';
    let currentAssistantMessageElement = null;
    let accumulatedResponseText = '';
    let currentMode = 'chat'; // Default mode

    // Animation state for smooth character-by-character display
    let characterQueue = []; // Stores characters to be displayed
    let isAnimating = false; // Flag to prevent multiple animation loops
    let animationIntervalId = null; // To store the interval ID
    const charAnimationDelay = 10; // Milliseconds between characters (adjust for speed)

    // Event listeners
    sendButtonElement.addEventListener('click', sendMessage);
    userInputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            // If the file search is open, don't send the message
            if (fileSearchContainer.style.display === 'block') {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            sendMessage();
        } else if (e.key === 'Escape') {
            // Close the file search if it's open
            if (fileSearchContainer.style.display === 'block') {
                hideFileSearch();
                e.preventDefault();
            }
        }
    });

    // Add input event listeners
    userInputElement.addEventListener('input', handleInputChange);
    userInputElement.addEventListener('input', autoResizeTextarea);

    // Header button event listeners
    newChatButton.addEventListener('click', () => {
        console.log('New chat button clicked');
        // Clear the chat UI
        clearChatUI();
        // Send message to extension to clear backend state
        vscode.postMessage({ type: 'clearChat' });
    });

    historyButton.addEventListener('click', () => {
        console.log('History button clicked');
        vscode.postMessage({ type: 'showHistory' });
    });

    settingsButton.addEventListener('click', () => {
        console.log('Settings button clicked (Not Implemented)');
        vscode.postMessage({ type: 'showInfoMessage', text: 'Settings feature coming soon!' });
    });

    // Mode picker dropdown functionality
    modePickerButton.addEventListener('click', (event) => {
        // Toggle dropdown visibility
        if (modeDropdown.style.display === 'block') {
            modeDropdown.style.display = 'none';
        } else {
            modeDropdown.style.display = 'block';
        }
        event.stopPropagation(); // Prevent the click from being detected by the document
    });

    // Handle clicks on mode dropdown options
    modeDropdown.addEventListener('click', (event) => {
        // Find the closest button element (could be the button itself or a child of it)
        const button = event.target.closest('button');
        if (button) {
            // Get the mode from the button's data attribute
            const mode = button.dataset.mode;

            // Update the current mode
            currentMode = mode;

            // Update the text in the mode picker button
            document.getElementById('current-mode-text').textContent = mode.charAt(0).toUpperCase() + mode.slice(1);

            // Hide the dropdown
            modeDropdown.style.display = 'none';

            // Handle mode-specific actions
            if (mode === 'agent') {
                // Show a temporary notification for agent mode
                showTemporaryNotification('Agent mode coming soon!');
            } else {
                console.log('Chat mode selected');
            }
        }
    });

    // Context add button functionality
    contextAddButton.addEventListener('click', () => {
        // Insert @ symbol at current cursor position
        const cursorPosition = userInputElement.selectionStart;
        const text = userInputElement.value;
        const newText = text.substring(0, cursorPosition) + '@' + text.substring(cursorPosition);
        userInputElement.value = newText;

        // Set cursor position after the @ symbol
        userInputElement.setSelectionRange(cursorPosition + 1, cursorPosition + 1);

        // Trigger input event to activate file search
        userInputElement.dispatchEvent(new Event('input', { bubbles: true }));

        // Focus the input
        userInputElement.focus();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (event) => {
        if (modeDropdown.style.display === 'block' &&
            !modePickerButton.contains(event.target) &&
            !modeDropdown.contains(event.target)) {
            modeDropdown.style.display = 'none';
        }
    });

    // Function to auto-resize the textarea based on content
    function autoResizeTextarea() {
        // Reset height to auto to get the correct scrollHeight
        userInputElement.style.height = 'auto';

        // Set the height to match the content (with a max height)
        const newHeight = Math.min(userInputElement.scrollHeight, 150);
        userInputElement.style.height = newHeight + 'px';

        // Ensure the input area doesn't exceed max height
        const inputArea = document.getElementById('input-area');
        if (inputArea) {
            const pillsHeight = document.getElementById('context-pills').offsetHeight;
            const actionRowHeight = document.getElementById('action-button-row').offsetHeight;
            const maxInputAreaHeight = 200; // Maximum height for the entire input area

            // Adjust textarea max height based on pills height and action row height
            const maxTextareaHeight = maxInputAreaHeight - pillsHeight - actionRowHeight - 24; // 24px for padding and margins
            if (newHeight > maxTextareaHeight) {
                userInputElement.style.height = maxTextareaHeight + 'px';
                userInputElement.style.overflowY = 'auto';
            } else {
                userInputElement.style.overflowY = 'hidden';
            }
        }
    }

    // Initialize textarea height
    autoResizeTextarea();

    // Function to handle input changes and detect @ mentions
    function handleInputChange() {
        const text = userInputElement.value;
        const cursorPosition = userInputElement.selectionStart;

        // Find the @ symbol before the cursor
        const textBeforeCursor = text.substring(0, cursorPosition);

        // Use regex to find the last @ followed by any non-whitespace characters up to the cursor
        // This will match @word, @word.ext, @path/file, etc. but not @word followed by a space
        const atMatch = textBeforeCursor.match(/@([^\s]*)$/);

        // console.log('Input change detected:', {
        //     text,
        //     cursorPosition,
        //     textBeforeCursor,
        //     atMatch
        // });

        if (atMatch) {
            // The query is the text after the @ symbol
            const query = atMatch[1]; // Group 1 from the regex match (text after @)
            const atIndex = atMatch.index; // Position of the @ symbol

            // console.log('@ pattern detected! Query:', query, 'at position:', atIndex);

            // If the query is empty (just @), show recent files
            if (!query) {
                // console.log('Empty query, showing recent files');
                currentSearchQuery = '';
                showRecentFiles();
            }
            // If the query is not empty and different from the current search
            else if (query !== currentSearchQuery) {
                // console.log('New search query detected:', query);
                currentSearchQuery = query;
                searchFiles(query);
            }
        } else {
            // console.log('No @ pattern detected or not at word boundary, hiding search results');
            // If there's no @ symbol before the cursor, hide the search results
            hideFileSearch();
        }
    }

    // Function to show recent files
    function showRecentFiles() {
        // console.log('Showing recent files');

        // Show loading indicator
        showFileSearchLoading();

        // Send request to get recent files
        const message = {
            type: 'getRecentFiles'
        };

        // console.log('Sending message to extension:', message);
        vscode.postMessage(message);
    }

    // Function to search for files
    function searchFiles(query) {
        // console.log('Searching files with query:', query);

        // Log special characters if present to help with debugging
        if (query.includes('.') || query.includes('/') || query.includes('\\')) {
            // console.log('Query contains special characters:',
            //             query.includes('.') ? 'dot' : '',
            //             query.includes('/') ? 'forward-slash' : '',
            //             query.includes('\\') ? 'backslash' : '');
        }

        // Show loading indicator
        showFileSearchLoading();

        // Send search request to extension
        const message = {
            type: 'searchWorkspaceFiles',
            query: query
        };

        // console.log('Sending message to extension:', message);
        vscode.postMessage(message);
    }

    // Function to show loading indicator
    function showFileSearchLoading() {
        // console.log('Showing file search loading indicator');
        isSearching = true;
        fileSearchContainer.style.display = 'block';
        fileSearchContainer.innerHTML = '<div class="loading">Searching files...</div>';

        // Position the container below the input
        positionFileSearchContainer();

        // Ensure proper styling
        fileSearchContainer.style.border = '1px solid var(--vscode-editorWidget-border, var(--vscode-input-border))';

        // console.log('File search container:', {
        //     display: fileSearchContainer.style.display,
        //     position: fileSearchContainer.style.position,
        //     top: fileSearchContainer.style.top,
        //     left: fileSearchContainer.style.left,
        //     width: fileSearchContainer.style.width,
        //     height: fileSearchContainer.style.height
        // });
    }

    // Function to hide file search
    function hideFileSearch() {
        isSearching = false;
        currentSearchQuery = '';
        fileSearchContainer.style.display = 'none';
    }

    // Function to position the file search container
    function positionFileSearchContainer() {
        // console.log('Positioning file search container');

        // Get the input area position
        const inputAreaRect = document.getElementById('input-area').getBoundingClientRect();

        // Calculate position to place it above the input area
        const top = inputAreaRect.top - 10; // Position above input area with a small gap
        const left = inputAreaRect.left + 10; // Align with the left edge of the input area with padding
        const width = inputAreaRect.width - 20; // Account for padding

        console.log('Positioning data:', {
            inputAreaRect,
            calculatedTop: top,
            calculatedLeft: left,
            calculatedWidth: width
        });

        // Set the position using fixed positioning
        fileSearchContainer.style.position = 'fixed';
        fileSearchContainer.style.top = 'auto'; // Clear any previous top value
        fileSearchContainer.style.bottom = `${window.innerHeight - top}px`; // Position from bottom of viewport
        fileSearchContainer.style.left = `${left}px`;
        fileSearchContainer.style.width = `${width}px`;
        fileSearchContainer.style.maxHeight = '300px';
        fileSearchContainer.style.overflowY = 'auto';
        fileSearchContainer.style.zIndex = '1000';
        fileSearchContainer.style.backgroundColor = 'var(--vscode-editorWidget-background, var(--vscode-editor-background))';
        fileSearchContainer.style.borderRadius = '6px';

        // Ensure the container is visible
        fileSearchContainer.style.display = 'block';
    }

    // Function to display file search results
    function displayFileSearchResults(results, isRecent = false) {
        console.log('displayFileSearchResults called with results:', results, 'isRecent:', isRecent);

        if (!isSearching) {
            console.log('Not searching, ignoring results');
            return;
        }

        if (!results || results.length === 0) {
            console.log('No results found, showing empty message');
            fileSearchContainer.innerHTML = '<div class="no-results">No files found</div>';

            // Make sure the container is visible
            fileSearchContainer.style.display = 'block';
            positionFileSearchContainer();

            // Ensure proper styling
            fileSearchContainer.style.border = '1px solid var(--vscode-editorWidget-border, var(--vscode-input-border))';

            return;
        }

        console.log('Creating results list with', results.length, 'items');
        fileSearchContainer.innerHTML = '';

        // Add header if showing recent files
        if (isRecent) {
            const header = document.createElement('div');
            header.className = 'file-search-header';
            header.textContent = 'Recently Opened Files';
            fileSearchContainer.appendChild(header);
        }

        const resultsList = document.createElement('ul');
        resultsList.className = 'file-search-results';
        resultsList.style.listStyle = 'none';
        resultsList.style.padding = '0';
        resultsList.style.margin = '0';

        results.forEach((result, index) => {
            // Use label for display if available (for recent files), otherwise use path
            const displayText = result.label || result.path;
            console.log('Adding result item:', displayText);

            const resultItem = document.createElement('li');
            resultItem.className = 'file-search-result';
            resultItem.textContent = displayText;
            resultItem.style.padding = '8px 12px';
            resultItem.style.cursor = 'pointer';
            resultItem.style.borderBottom = index < results.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none';

            // Highlight on hover
            resultItem.addEventListener('mouseover', () => {
                resultItem.style.backgroundColor = 'var(--vscode-list-hoverBackground)';
            });

            resultItem.addEventListener('mouseout', () => {
                resultItem.style.backgroundColor = 'transparent';
            });

            // Add click handler
            resultItem.addEventListener('click', () => {
                console.log('File selected:', result);
                selectFile(result);
            });

            resultsList.appendChild(resultItem);
        });

        fileSearchContainer.appendChild(resultsList);

        // Make sure the container is visible
        fileSearchContainer.style.display = 'block';
        positionFileSearchContainer();

        // Ensure proper styling
        fileSearchContainer.style.border = '1px solid var(--vscode-editorWidget-border, var(--vscode-input-border))';

        console.log('Results list created and added to DOM');
    }

    // Function to select a file from the search results
    function selectFile(file) {
        // Get the current text and cursor position
        const text = userInputElement.value;
        const cursorPosition = userInputElement.selectionStart;
        const textBeforeCursor = text.substring(0, cursorPosition);
        const atIndex = textBeforeCursor.lastIndexOf('@');

        if (atIndex !== -1) {
            // Remove the @query from the input
            const newText = text.substring(0, atIndex) + text.substring(cursorPosition);
            userInputElement.value = newText;

            // Set cursor position where the @ was
            userInputElement.setSelectionRange(atIndex, atIndex);

            // Log the file selection
            console.log(`>>> File Selected: ${file.path}, URI: ${file.uriString}`);

            // Add the file to the context in the backend
            // The backend will handle updating the UI via updateContextPills
            vscode.postMessage({
                type: 'addFileToContextViaMention',
                uriString: file.uriString
            });

            // Hide the search results
            hideFileSearch();

            // Focus the input
            userInputElement.focus();
        }
    }

    // Function to create a context pill
    function createContextPill(file) {
        console.log('>>> Create Context Pill: Called with file:', file);

        // Validate file object
        if (!file || typeof file !== 'object') {
            console.error('>>> Create Context Pill: Invalid file object:', file);
            return;
        }

        // Validate file path
        if (!file.path || typeof file.path !== 'string' || file.path.trim() === '') {
            console.error('>>> Create Context Pill: Invalid or empty file path:', file);
            return;
        }

        // Validate URI string
        if (!file.uriString || typeof file.uriString !== 'string' || file.uriString.trim() === '') {
            console.error('>>> Create Context Pill: Invalid or empty URI string:', file);
            return;
        }

        console.log(`>>> Create Context Pill: Creating pill for path: ${file.path}, URI: ${file.uriString}`);

        // Create the pill element
        const pill = document.createElement('div');
        pill.className = 'context-pill';
        pill.dataset.uri = file.uriString;

        // Create the filename span
        const filename = document.createElement('span');
        filename.className = 'pill-filename';
        filename.textContent = file.path;

        // Create the close button
        const closeButton = document.createElement('button');
        closeButton.className = 'pill-close-button';

        // Use Codicon for close button
        const closeIcon = document.createElement('i');
        closeIcon.className = 'codicon codicon-close';
        closeButton.appendChild(closeIcon);

        closeButton.title = 'Remove from context';

        // Add event listener to close button
        closeButton.addEventListener('click', (e) => {
            e.preventDefault();

            console.log(`>>> Pill Close Button: Click detected on pill with URI: ${pill.dataset.uri}`);

            // Validate the pill element before passing to removeContextPill
            if (!pill || !pill.parentNode) {
                console.error('>>> Pill Close Button: Pill element is invalid or already removed from DOM');
                return;
            }

            // Validate the URI string
            if (!pill.dataset.uri || pill.dataset.uri.trim() === '') {
                console.error('>>> Pill Close Button: Pill has invalid or empty URI string:', pill);
                // Still remove the pill from the DOM to prevent UI inconsistency
                pill.remove();
                return;
            }

            // Call removeContextPill with the validated pill
            removeContextPill(pill);
        });

        // Assemble the pill
        pill.appendChild(filename);
        pill.appendChild(closeButton);

        // Add the pill to the context pills container
        contextPillsElement.appendChild(pill);

        // Force browser reflow - reading offsetHeight is a common trick
        console.log('>>> Pill Render Fix: Pill appended to DOM. Forcing reflow...');
        const forcedHeight = pill.offsetHeight;
        console.log('>>> Pill Render Fix: Read offsetHeight (forced reflow):', forcedHeight);
    }

    // Function to remove a context pill
    function removeContextPill(pill) {
        // Validate the pill parameter
        if (!pill || !(pill instanceof Element) || !pill.classList.contains('context-pill')) {
            console.error('>>> Pill Remove: Invalid pill element provided:', pill);
            return;
        }

        // Get the URI string from the pill's dataset
        const uriString = pill.dataset.uri;
        console.log(`>>> Pill Remove: Getting URI string from pill:`, uriString);

        // Validate the URI string
        if (!uriString || uriString.trim() === '') {
            console.error(`>>> Pill Remove: Invalid or empty URI string found in pill:`, pill);
            // Still remove the pill from the DOM to prevent UI inconsistency
            pill.remove();
            console.log(`>>> Pill Remove: Removed invalid pill element from DOM without sending message`);
            return;
        }

        // We no longer remove the pill from the DOM here
        // The backend will handle updating the UI via updateContextPills
        console.log(`>>> Pill Remove: Sending removeFileFromContext for ${uriString}`);

        // Send message to extension to remove the file from context
        vscode.postMessage({
            type: 'removeFileFromContext',
            uriString: uriString
        });
    }

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;

        console.log('Webview received message from extension:', message);

        switch (message.type) {
            case 'updateContextFiles':
                console.log('Handling updateContextFiles with files:', message.files);
                // Store the files but don't update UI (pills are managed directly)
                contextFiles = message.files;
                break;
            case 'updateContextPills':
                console.log('>>> Handling updateContextPills with paths:', message.contextPaths);
                console.log('>>> URI strings:', message.contextUriStrings);

                // This is the new centralized way to update context pills
                // We completely rebuild the pills based on the backend state
                updateContextPillsFromBackend(message.contextPaths, message.contextUriStrings);
                break;

            case 'contextUpdated':
                console.log('>>> Handling legacy contextUpdated with files:', message.files);
                // Store the files for backward compatibility
                contextFiles = message.files;

                // Log the current pills in the DOM for debugging
                const currentPills = Array.from(contextPillsElement.children);
                console.log('>>> Current pills in DOM:', currentPills.map(pill => pill.dataset.uri));
                break;
            case 'addChatMessage':
                console.log('Handling addChatMessage:', message);
                addChatMessage(message.sender, message.text);
                break;
            case 'assistantResponse':
                console.log('Handling assistantResponse:', message.text);
                addChatMessage('assistant', message.text);
                break;
            case 'geminiThinking':
                console.log('Handling geminiThinking');
                // Stop any ongoing animation
                stopCharacterAnimation();
                // Reset streaming state
                if (currentAssistantMessageElement) {
                    currentAssistantMessageElement = null;
                    accumulatedResponseText = '';
                }
                showThinkingIndicator();
                break;
            case 'geminiStreamStart':
                console.log('Handling geminiStreamStart');
                // Create a placeholder for the streaming response
                hideThinkingIndicator();
                startStreamingResponse();
                break;
            case 'geminiResponseChunk':
                console.log('Handling geminiResponseChunk');
                // Add the chunk to the current response
                appendResponseChunk(message.chunk);
                break;
            case 'geminiStreamEnd':
                console.log('Handling geminiStreamEnd');
                // Finalize the response with markdown rendering
                finalizeStreamingResponse();
                break;
            case 'geminiResponse':
                console.log('Handling geminiResponse:', message.text);
                // This is for backward compatibility or non-streaming responses
                hideThinkingIndicator();
                addChatMessage('assistant', message.text);
                break;
            case 'geminiError':
                console.log('Handling geminiError:', message.text);
                hideThinkingIndicator();
                // Stop any ongoing animation
                stopCharacterAnimation();
                // If we were in the middle of streaming, clean up
                if (currentAssistantMessageElement) {
                    currentAssistantMessageElement.remove();
                    currentAssistantMessageElement = null;
                    accumulatedResponseText = '';
                }
                showErrorMessage(message.text);
                break;
            case 'geminiFinishedThinking':
                console.log('Handling geminiFinishedThinking');
                hideThinkingIndicator();
                break;
            case 'clearChat':
                console.log('Handling clearChat');
                clearChat();
                break;
            case 'fileSearchResults':
                console.log('Handling fileSearchResults with results:', message.results);
                console.log('Number of results:', message.results ? message.results.length : 0);
                console.log('Is recent files:', message.isRecent);
                displayFileSearchResults(message.results, message.isRecent);
                break;
            case 'fileAddedToContext':
                if (message.success) {
                    console.log(`File added to context: ${message.path}`);
                } else {
                    console.error('Failed to add file to context:', message.error);
                }
                break;
            case 'restoreChat':
                console.log('Handling restoreChat with history length:', message.history.length);
                restoreChat(message.history);
                break;
            case 'restoreContextPills':
                console.log('Handling restoreContextPills with paths:', message.contextPaths);
                restoreContextPills(message.contextPaths, message.contextUriStrings);
                break;
            default:
                console.log('Unhandled message type:', message.type);
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

            // Resize the textarea
            autoResizeTextarea();
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

        // If this is an assistant message, render it as markdown
        if (sender === 'assistant') {
            try {
                console.log('Rendering markdown for assistant message');

                // Initialize markdown-it with syntax highlighting
                const md = window.markdownit({
                    html: false, // Don't allow HTML tags in source for security
                    linkify: true, // Autoconvert URL-like text to links
                    typographer: true, // Enable smartquotes, dashes, etc.
                    highlight: function (str, lang) {
                        console.log('Highlighting code block with language:', lang);

                        if (lang && window.hljs.getLanguage(lang)) {
                            try {
                                // Properly wrap the highlighted code in pre and code tags
                                return '<pre class="hljs"><code class="language-' + lang + '">' +
                                       window.hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                                       '</code></pre>';
                            } catch (error) {
                                console.error('Error highlighting code:', error);
                            }
                        }

                        // Use default escaping if no language or highlight fails
                        return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
                    }
                });

                // Render the markdown
                const renderedHtml = md.render(text);
                console.log('Rendered HTML:', renderedHtml);

                // Set the innerHTML
                textElement.innerHTML = renderedHtml;

                // Add a class to the message element for styling
                messageElement.classList.add('markdown-message');

                // Apply highlighting to any code blocks that might have been missed
                // and add action buttons to code blocks
                setTimeout(() => {
                    const preBlocks = textElement.querySelectorAll('pre');
                    console.log('Found', preBlocks.length, 'pre blocks for highlighting and buttons');

                    preBlocks.forEach(preBlock => {
                        try {
                            // Find the code element inside the pre block
                            const codeBlock = preBlock.querySelector('code');
                            if (codeBlock) {
                                // Apply syntax highlighting
                                window.hljs.highlightElement(codeBlock);

                                // Add a container for the code block and buttons
                                const codeContainer = document.createElement('div');
                                codeContainer.className = 'code-block-container';

                                // Create button container
                                const buttonContainer = document.createElement('div');
                                buttonContainer.className = 'code-block-buttons';

                                // Create Copy button
                                const copyButton = document.createElement('button');
                                copyButton.className = 'code-button copy-button';
                                copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                                copyButton.title = 'Copy code to clipboard';

                                // Create Insert button
                                const insertButton = document.createElement('button');
                                insertButton.className = 'code-button insert-button';
                                insertButton.innerHTML = '<i class="codicon codicon-add"></i>';
                                insertButton.title = 'Insert code at cursor position';

                                // Add event listener for Copy button
                                copyButton.addEventListener('click', () => {
                                    const codeText = codeBlock.textContent;
                                    navigator.clipboard.writeText(codeText)
                                        .then(() => {
                                            // Show feedback
                                            copyButton.innerHTML = '<i class="codicon codicon-check"></i>';
                                            copyButton.classList.add('copied');

                                            // Reset after 2 seconds
                                            setTimeout(() => {
                                                copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                                                copyButton.classList.remove('copied');
                                            }, 2000);
                                        })
                                        .catch(err => {
                                            console.error('Error copying text: ', err);
                                            copyButton.innerHTML = '<i class="codicon codicon-error"></i>';

                                            // Reset after 2 seconds
                                            setTimeout(() => {
                                                copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                                            }, 2000);
                                        });
                                });

                                // Add event listener for Insert button
                                insertButton.addEventListener('click', () => {
                                    const codeText = codeBlock.textContent;
                                    vscode.postMessage({
                                        type: 'insertCode',
                                        code: codeText
                                    });

                                    // Show feedback
                                    insertButton.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i>';

                                    // Reset after 2 seconds
                                    setTimeout(() => {
                                        insertButton.innerHTML = '<i class="codicon codicon-add"></i>';
                                    }, 2000);
                                });

                                // Add buttons to button container
                                buttonContainer.appendChild(copyButton);
                                buttonContainer.appendChild(insertButton);

                                // Wrap the pre block with our container
                                preBlock.parentNode.insertBefore(codeContainer, preBlock);
                                codeContainer.appendChild(preBlock);
                                codeContainer.appendChild(buttonContainer);
                            }
                        } catch (error) {
                            console.error('Error processing code block:', error);
                        }
                    });
                }, 0);
            } catch (error) {
                console.error('Error rendering markdown:', error);
                textElement.textContent = text; // Fallback to plain text
            }
        } else {
            // For user messages, just use plain text
            textElement.textContent = text;
        }

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

        // Call the global highlight function after a short delay to ensure DOM is updated
        if (sender === 'assistant' && typeof window.highlightAllCodeBlocks === 'function') {
            setTimeout(window.highlightAllCodeBlocks, 100);
        }
    }

    // This function is kept for state management but no longer updates UI
    // Context pills are managed directly when files are added/removed
    function updateContextFiles(files) {
        console.log('Updating context files (state only):', files);
        contextFiles = files;

        // Save state after updating context files
        saveState();
    }

    // Function to sync context pills with backend state (used when loading state)
    function syncContextPills(files) {
        console.log('>>> Sync Context Pills: Called with files:', files);
        console.log('>>> Sync Context Pills: WARNING - This function is deprecated');
        console.log('>>> Sync Context Pills: The backend should use updateContextPills instead');

        // Validate files array
        if (!files || !Array.isArray(files)) {
            console.error('>>> Sync Context Pills: Invalid files array:', files);
            return;
        }

        // Instead of creating pills directly, send a message to the backend
        // to get the proper URI strings and then update the pills
        vscode.postMessage({
            type: 'requestContextUpdate'
        });

        console.log('>>> Sync Context Pills: Requested context update from backend');
    }

    function clearChat() {
        // Remove all messages
        chatHistoryElement.innerHTML = '';

        // Add welcome message back
        const welcomeMessage = document.createElement('div');
        welcomeMessage.className = 'welcome-message';
        welcomeMessage.innerHTML = `
            <h2>Welcome to Codexpilot!</h2>
            <p>Add files to the context by typing @ followed by a filename</p>
        `;
        chatHistoryElement.appendChild(welcomeMessage);

        // Clear chat history
        chatHistory = [];

        // Save state
        saveState();
    }

    /**
     * Clear the chat UI including messages and context pills
     */
    function clearChatUI() {
        // Clear chat messages
        chatHistoryElement.innerHTML = '';

        // Add welcome message back
        const welcomeMessage = document.createElement('div');
        welcomeMessage.className = 'welcome-message';
        welcomeMessage.innerHTML = `
            <h2>Welcome to Codexpilot!</h2>
            <p>Add files to the context by typing @ followed by a filename</p>
        `;
        chatHistoryElement.appendChild(welcomeMessage);

        // Clear context pills
        contextPillsElement.innerHTML = '';

        // Clear chat history array
        chatHistory = [];

        // Add a system message
        addSystemMessage('New chat started');

        // Save state
        saveState();
    }

    /**
     * Add a system message to the chat
     * @param {string} text The message text
     */
    function addSystemMessage(text) {
        // Create message element
        const messageElement = document.createElement('div');
        messageElement.className = 'message system-message';

        const textElement = document.createElement('div');
        textElement.className = 'message-text';
        textElement.textContent = text;

        messageElement.appendChild(textElement);
        chatHistoryElement.appendChild(messageElement);

        // Scroll to bottom
        chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
    }

    /**
     * Restore a chat from history
     * @param {Array} history The conversation history to restore
     */
    function restoreChat(history) {
        // Clear the current chat
        chatHistoryElement.innerHTML = '';

        // If history is empty, show welcome message
        if (!history || history.length === 0) {
            const welcomeMessage = document.createElement('div');
            welcomeMessage.className = 'welcome-message';
            welcomeMessage.innerHTML = `
                <h2>Welcome to Codexpilot!</h2>
                <p>Add files to the context by typing @ followed by a filename</p>
            `;
            chatHistoryElement.appendChild(welcomeMessage);
            return;
        }

        // Add a system message indicating chat was loaded
        addSystemMessage('Chat loaded from history');

        // Loop through the history and add messages
        for (const message of history) {
            if (message.role === 'user') {
                // For user messages, extract the actual query if it contains context
                let userText = message.parts[0].text;
                if (userText.includes('USER QUERY:')) {
                    userText = userText.split('USER QUERY:')[1].trim();
                }
                addChatMessage('user', userText);
            } else if (message.role === 'model') {
                // For model messages, render as assistant
                addChatMessage('assistant', message.parts[0].text);
            }
        }

        // Scroll to bottom
        chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
    }

    /**
     * Update context pills from backend state
     * This is the centralized function to update the UI based on the backend state
     * @param {Array} contextPaths The paths of the context files
     * @param {Array} contextUriStrings The URI strings of the context files
     */
    function updateContextPillsFromBackend(contextPaths, contextUriStrings) {
        console.log('>>> Update Context Pills: Starting with paths:', contextPaths);
        console.log('>>> Update Context Pills: URI strings:', contextUriStrings);

        // Clear existing pills - this is critical for proper synchronization
        contextPillsElement.innerHTML = '';
        console.log('>>> Update Context Pills: Cleared existing pills');

        // Create pills for each file
        if (contextPaths && contextPaths.length > 0) {
            // Ensure contextUriStrings is an array
            if (!Array.isArray(contextUriStrings)) {
                console.error('>>> Update Context Pills: contextUriStrings is not an array:', contextUriStrings);
                contextUriStrings = [];
            }

            // Create pills only for valid entries
            contextPaths.forEach((path, index) => {
                // Skip if path is empty
                if (!path || path.trim() === '') {
                    console.warn(`>>> Update Context Pills: Skipping empty path at index ${index}`);
                    return;
                }

                // Get the URI string for this path
                const uriString = contextUriStrings[index] || '';

                // Skip if URI string is empty
                if (!uriString || uriString.trim() === '') {
                    console.warn(`>>> Update Context Pills: Skipping path with empty URI string: ${path}`);
                    return;
                }

                console.log(`>>> Update Context Pills: Creating pill for path: ${path}, URI: ${uriString}`);

                // Create a file object for the pill
                const file = {
                    path: path,
                    uriString: uriString
                };

                // Create the pill
                createContextPill(file);
            });

            console.log(`>>> Update Context Pills: Created ${contextPaths.length} pills`);
        } else {
            console.log('>>> Update Context Pills: No paths to display');
        }
    }

    /**
     * Restore context pills from history
     * @param {Array} contextPaths The paths of the context files
     * @param {Array} contextUriStrings The URI strings of the context files
     */
    function restoreContextPills(contextPaths, contextUriStrings) {
        console.log('>>> Restore Context Pills: Delegating to updateContextPillsFromBackend');
        // Use the centralized function to update the pills
        updateContextPillsFromBackend(contextPaths, contextUriStrings);
    }

    // Function to show thinking indicator
    function showThinkingIndicator() {
        // Disable input and send button
        userInputElement.disabled = true;
        sendButtonElement.disabled = true;

        // Add a thinking message
        const thinkingElement = document.createElement('div');
        thinkingElement.className = 'message assistant-message thinking-message';
        thinkingElement.id = 'thinking-indicator';

        const senderElement = document.createElement('div');
        senderElement.className = 'message-sender';
        senderElement.textContent = 'Assistant';

        const textElement = document.createElement('div');
        textElement.className = 'message-text';
        textElement.innerHTML = '<div class="thinking-dots"><span>.</span><span>.</span><span>.</span></div> Thinking...';

        thinkingElement.appendChild(senderElement);
        thinkingElement.appendChild(textElement);

        chatHistoryElement.appendChild(thinkingElement);

        // Scroll to bottom
        chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
    }

    // Function to hide thinking indicator
    function hideThinkingIndicator() {
        // Enable input and send button
        userInputElement.disabled = false;
        sendButtonElement.disabled = false;

        // Remove thinking message if it exists
        const thinkingElement = document.getElementById('thinking-indicator');
        if (thinkingElement) {
            thinkingElement.remove();
        }
    }

    // Function to start the character animation
    function startCharacterAnimation() {
        // If already animating, don't start another animation loop
        if (isAnimating) {
            return;
        }

        // Set the animation flag
        isAnimating = true;

        // Clear any existing animation interval
        if (animationIntervalId) {
            clearInterval(animationIntervalId);
        }

        // Start the animation interval
        animationIntervalId = setInterval(() => {
            // If there are no more characters to display, stop the animation
            if (characterQueue.length === 0) {
                clearInterval(animationIntervalId);
                animationIntervalId = null;
                isAnimating = false;
                return;
            }

            // Get the next character from the queue
            const char = characterQueue.shift();

            // If we have a message element, append the character
            if (currentAssistantMessageElement) {
                const textElement = currentAssistantMessageElement.querySelector('.message-text');
                textElement.textContent += char;

                // Scroll to bottom
                chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
            } else {
                // If there's no message element, clear the queue and stop animating
                characterQueue = [];
                clearInterval(animationIntervalId);
                animationIntervalId = null;
                isAnimating = false;
            }
        }, charAnimationDelay);
    }

    // Function to stop any ongoing animation
    function stopCharacterAnimation() {
        if (animationIntervalId) {
            clearInterval(animationIntervalId);
            animationIntervalId = null;
        }
        isAnimating = false;
        characterQueue = [];
    }

    // Function to start streaming response
    function startStreamingResponse() {
        // Stop any existing animation
        stopCharacterAnimation();

        // Reset accumulated text and character queue
        accumulatedResponseText = '';
        characterQueue = [];

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.className = 'message assistant-message streaming-message';

        const senderElement = document.createElement('div');
        senderElement.className = 'message-sender';
        senderElement.textContent = 'Assistant';

        const textElement = document.createElement('div');
        textElement.className = 'message-text';
        textElement.textContent = ''; // Start empty

        messageElement.appendChild(senderElement);
        messageElement.appendChild(textElement);

        chatHistoryElement.appendChild(messageElement);

        // Store reference to the message element
        currentAssistantMessageElement = messageElement;

        // Scroll to bottom
        chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
    }

    // Function to append a chunk to the streaming response
    function appendResponseChunk(chunk) {
        if (!currentAssistantMessageElement) {
            console.error('No current assistant message element to append chunk to');
            return;
        }

        // Add the chunk to the accumulated text (for final rendering)
        accumulatedResponseText += chunk;

        // Add each character to the animation queue
        characterQueue.push(...chunk.split(''));

        // Start the animation if it's not already running
        if (!isAnimating) {
            startCharacterAnimation();
        }
    }

    // Function to finalize the streaming response with markdown rendering
    function finalizeStreamingResponse() {
        // Stop any ongoing animation first
        stopCharacterAnimation();

        if (!currentAssistantMessageElement || !accumulatedResponseText) {
            console.log('No streaming response to finalize');
            return;
        }

        try {
            console.log('Finalizing streaming response with markdown rendering');

            // Get the text element
            const textElement = currentAssistantMessageElement.querySelector('.message-text');

            // Initialize markdown-it with syntax highlighting
            const md = window.markdownit({
                html: false, // Don't allow HTML tags in source for security
                linkify: true, // Autoconvert URL-like text to links
                typographer: true, // Enable smartquotes, dashes, etc.
                highlight: function (str, lang) {
                    console.log('Highlighting code block with language:', lang);

                    if (lang && window.hljs.getLanguage(lang)) {
                        try {
                            // Properly wrap the highlighted code in pre and code tags
                            return '<pre class="hljs"><code class="language-' + lang + '">' +
                                   window.hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                                   '</code></pre>';
                        } catch (error) {
                            console.error('Error highlighting code:', error);
                        }
                    }

                    // Use default escaping if no language or highlight fails
                    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
                }
            });

            // Render the markdown
            const renderedHtml = md.render(accumulatedResponseText);
            console.log('Rendered HTML:', renderedHtml);

            // Set the innerHTML
            textElement.innerHTML = renderedHtml;

            // Add a class to the message element for styling
            currentAssistantMessageElement.classList.add('markdown-message');

            // Add the message to chat history
            chatHistory.push({
                sender: 'assistant',
                text: accumulatedResponseText
            });

            // Process code blocks to add buttons
            setTimeout(() => {
                const preBlocks = textElement.querySelectorAll('pre');
                console.log('Found', preBlocks.length, 'pre blocks for highlighting and buttons');

                preBlocks.forEach(preBlock => {
                    try {
                        // Find the code element inside the pre block
                        const codeBlock = preBlock.querySelector('code');
                        if (codeBlock) {
                            // Apply syntax highlighting
                            window.hljs.highlightElement(codeBlock);

                            // Add a container for the code block and buttons
                            const codeContainer = document.createElement('div');
                            codeContainer.className = 'code-block-container';

                            // Create button container
                            const buttonContainer = document.createElement('div');
                            buttonContainer.className = 'code-block-buttons';

                            // Create Copy button
                            const copyButton = document.createElement('button');
                            copyButton.className = 'code-button copy-button';
                            copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                            copyButton.title = 'Copy code to clipboard';

                            // Create Insert button
                            const insertButton = document.createElement('button');
                            insertButton.className = 'code-button insert-button';
                            insertButton.innerHTML = '<i class="codicon codicon-add"></i>';
                            insertButton.title = 'Insert code at cursor position';

                            // Add event listener for Copy button
                            copyButton.addEventListener('click', () => {
                                const codeText = codeBlock.textContent;
                                navigator.clipboard.writeText(codeText)
                                    .then(() => {
                                        // Show feedback
                                        copyButton.innerHTML = '<i class="codicon codicon-check"></i>';
                                        copyButton.classList.add('copied');

                                        // Reset after 2 seconds
                                        setTimeout(() => {
                                            copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                                            copyButton.classList.remove('copied');
                                        }, 2000);
                                    })
                                    .catch(err => {
                                        console.error('Error copying text: ', err);
                                        copyButton.innerHTML = '<i class="codicon codicon-error"></i>';

                                        // Reset after 2 seconds
                                        setTimeout(() => {
                                            copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                                        }, 2000);
                                    });
                            });

                            // Add event listener for Insert button
                            insertButton.addEventListener('click', () => {
                                const codeText = codeBlock.textContent;
                                vscode.postMessage({
                                    type: 'insertCode',
                                    code: codeText
                                });

                                // Show feedback
                                insertButton.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i>';

                                // Reset after 2 seconds
                                setTimeout(() => {
                                    insertButton.innerHTML = '<i class="codicon codicon-add"></i>';
                                }, 2000);
                            });

                            // Add buttons to button container
                            buttonContainer.appendChild(copyButton);
                            buttonContainer.appendChild(insertButton);

                            // Wrap the pre block with our container
                            preBlock.parentNode.insertBefore(codeContainer, preBlock);
                            codeContainer.appendChild(preBlock);
                            codeContainer.appendChild(buttonContainer);
                        }
                    } catch (error) {
                        console.error('Error processing code block:', error);
                    }
                });
            }, 0);

            // Save state
            saveState();

        } catch (error) {
            console.error('Error finalizing streaming response:', error);

            // Fallback to plain text if markdown rendering fails
            const textElement = currentAssistantMessageElement.querySelector('.message-text');
            textElement.textContent = accumulatedResponseText;

            // Add to chat history
            chatHistory.push({
                sender: 'assistant',
                text: accumulatedResponseText
            });

            // Save state
            saveState();
        } finally {
            // Reset streaming state
            currentAssistantMessageElement = null;
            accumulatedResponseText = '';
        }
    }

    // Function to show error message
    function showErrorMessage(errorText) {
        // Add error message
        const errorElement = document.createElement('div');
        errorElement.className = 'message error-message';

        const senderElement = document.createElement('div');
        senderElement.className = 'message-sender';
        senderElement.textContent = 'Error';

        const textElement = document.createElement('div');
        textElement.className = 'message-text';

        // Format the error message as markdown if it contains code blocks
        if (errorText.includes('```')) {
            try {
                const md = window.markdownit({
                    html: false,
                    linkify: true,
                    typographer: true,
                    highlight: function (str, lang) {
                        console.log('Highlighting error code block with language:', lang);

                        if (lang && window.hljs.getLanguage(lang)) {
                            try {
                                // Properly wrap the highlighted code in pre and code tags
                                return '<pre class="hljs"><code class="language-' + lang + '">' +
                                       window.hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                                       '</code></pre>';
                            } catch (error) {
                                console.error('Error highlighting code in error message:', error);
                            }
                        }

                        // Use default escaping if no language or highlight fails
                        return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
                    }
                });

                const renderedHtml = md.render(errorText);
                console.log('Rendered error HTML:', renderedHtml);

                textElement.innerHTML = renderedHtml;
                errorElement.classList.add('markdown-message');

                // Apply highlighting to any code blocks that might have been missed
                // and add action buttons to code blocks
                setTimeout(() => {
                    const preBlocks = textElement.querySelectorAll('pre');
                    console.log('Found', preBlocks.length, 'pre blocks for highlighting and buttons in error');

                    preBlocks.forEach(preBlock => {
                        try {
                            // Find the code element inside the pre block
                            const codeBlock = preBlock.querySelector('code');
                            if (codeBlock) {
                                // Apply syntax highlighting
                                window.hljs.highlightElement(codeBlock);

                                // Add a container for the code block and buttons
                                const codeContainer = document.createElement('div');
                                codeContainer.className = 'code-block-container';

                                // Create button container
                                const buttonContainer = document.createElement('div');
                                buttonContainer.className = 'code-block-buttons';

                                // Create Copy button
                                const copyButton = document.createElement('button');
                                copyButton.className = 'code-button copy-button';
                                copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                                copyButton.title = 'Copy code to clipboard';

                                // Create Insert button
                                const insertButton = document.createElement('button');
                                insertButton.className = 'code-button insert-button';
                                insertButton.innerHTML = '<i class="codicon codicon-insert"></i>';
                                insertButton.title = 'Insert code at cursor position';

                                // Add event listener for Copy button
                                copyButton.addEventListener('click', () => {
                                    const codeText = codeBlock.textContent;
                                    navigator.clipboard.writeText(codeText)
                                        .then(() => {
                                            // Show feedback
                                            copyButton.innerHTML = '<i class="codicon codicon-check"></i>';
                                            copyButton.classList.add('copied');

                                            // Reset after 2 seconds
                                            setTimeout(() => {
                                                copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                                                copyButton.classList.remove('copied');
                                            }, 2000);
                                        })
                                        .catch(err => {
                                            console.error('Error copying text: ', err);
                                            copyButton.innerHTML = '<i class="codicon codicon-error"></i>';

                                            // Reset after 2 seconds
                                            setTimeout(() => {
                                                copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                                            }, 2000);
                                        });
                                });

                                // Add event listener for Insert button
                                insertButton.addEventListener('click', () => {
                                    const codeText = codeBlock.textContent;
                                    vscode.postMessage({
                                        type: 'insertCode',
                                        code: codeText
                                    });

                                    // Show feedback
                                    insertButton.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i>';

                                    // Reset after 2 seconds
                                    setTimeout(() => {
                                        insertButton.innerHTML = '<i class="codicon codicon-add"></i>';
                                    }, 2000);
                                });

                                // Add buttons to button container
                                buttonContainer.appendChild(copyButton);
                                buttonContainer.appendChild(insertButton);

                                // Wrap the pre block with our container
                                preBlock.parentNode.insertBefore(codeContainer, preBlock);
                                codeContainer.appendChild(preBlock);
                                codeContainer.appendChild(buttonContainer);
                            }
                        } catch (error) {
                            console.error('Error processing code block in error message:', error);
                        }
                    });
                }, 0);
            } catch (error) {
                console.error('Error rendering markdown in error message:', error);
                textElement.textContent = errorText;
            }
        } else {
            textElement.textContent = errorText;
        }

        errorElement.appendChild(senderElement);
        errorElement.appendChild(textElement);

        chatHistoryElement.appendChild(errorElement);

        // Scroll to bottom
        chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;

        // Save state
        saveState();

        // Call the global highlight function after a short delay to ensure DOM is updated
        if (errorText.includes('```') && typeof window.highlightAllCodeBlocks === 'function') {
            setTimeout(window.highlightAllCodeBlocks, 100);
        }
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
                // Update state
                contextFiles = state.contextFiles;

                // Create pills for the files
                syncContextPills(state.contextFiles);
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

    // Function to show a temporary notification in the webview
    function showTemporaryNotification(message) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'temporary-notification';
        notification.textContent = message;
        notification.style.position = 'fixed';
        notification.style.bottom = '60px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.backgroundColor = 'var(--vscode-notificationToast-background, var(--vscode-editor-background))';
        notification.style.color = 'var(--vscode-notificationToast-foreground, var(--vscode-editor-foreground))';
        notification.style.padding = '8px 16px';
        notification.style.borderRadius = '4px';
        notification.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
        notification.style.zIndex = '1000';
        notification.style.fontSize = '12px';
        notification.style.border = '1px solid var(--vscode-notificationToast-border, var(--vscode-panel-border))';

        // Add to DOM
        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.5s ease';

            // Remove from DOM after fade out
            setTimeout(() => {
                notification.remove();
            }, 500);
        }, 3000);
    }
})();
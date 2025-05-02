# Codexpilot

<!-- Insert your extension icon here -->
![Codexpilot Icon](images/icon.png)

<!-- Insert badges here -->
[![Version](https://img.shields.io/visual-studio-marketplace/v/YOUR_PUBLISHER_ID.codexpilot)](https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER_ID.codexpilot)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/YOUR_PUBLISHER_ID.codexpilot)](https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER_ID.codexpilot)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/YOUR_PUBLISHER_ID.codexpilot)](https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER_ID.codexpilot)

Codexpilot is a VS Code extension that integrates Google's Gemini AI to provide intelligent code assistance with codebase context. Simply chat with Gemini and reference your project files using '@' mentions to get contextually relevant help with your code.

## Features

- **Google Gemini Integration**: Powered by Google's advanced Gemini 1.5 Pro model for intelligent code understanding and generation
- **Codebase Context via '@' Mentions**: Easily reference files in your workspace by typing '@' to provide context to the AI
- **File Search**: Quick access to recent files or search your entire workspace
- **Streaming Responses**: See AI responses in real-time as they're generated
- **Rich Markdown Rendering**: Beautiful formatting with syntax highlighting for code blocks
- **Code Actions**: Copy code snippets to clipboard or insert them directly at your cursor position
- **Chat Management**: Start new conversations with a single click
- **Secure API Key Storage**: Your Gemini API key is securely stored using VS Code's built-in secret storage

## Requirements

- Visual Studio Code v1.74.0 or higher
- Google AI Studio API Key for Gemini

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Codexpilot"
4. Click Install

## Getting Started

### Obtaining a Gemini API Key

To use Codexpilot, you'll need a Google AI Studio API key:

1. Visit [Google AI Studio](https://aistudio.google.com/)
2. Sign in with your Google account
3. Navigate to the API keys section
4. Create a new API key
5. Copy the key for use in Codexpilot

### Setting Your API Key

Before using Codexpilot, you need to set your Gemini API key:

1. Open the Command Palette (Ctrl+Shift+P)
2. Type "Codexpilot: Set Gemini API Key"
3. Paste your API key when prompted
4. Your key will be securely stored in VS Code's secret storage

## How to Use

### Accessing the Chat View

1. Click the Codexpilot rocket icon in the Activity Bar
2. The chat interface will appear in the sidebar

### Starting a Chat

1. Type your question or request in the input box at the bottom of the chat view
2. Press Enter or click the Send button to submit your message

### Adding File Context (@ Mentions)

1. Type '@' in your message to trigger the file selector
2. Choose from recently accessed files or search for a specific file
3. Select a file to add it to your message context
4. You can add multiple files by using '@' multiple times
5. The AI will use these files as context when generating responses

### Removing File Context

- Click the 'x' on any file pill in the context area to remove that file from the current context

### Interacting with Responses

- **Copy Code**: Click the Copy button next to any code block to copy it to your clipboard
- **Insert Code**: Click the Insert button to insert code directly at your cursor position in the active editor

### Managing Chats

- Click the New Chat button (+ icon) in the header to start a fresh conversation
- Access settings and other options from the header controls

## Screenshots

<!-- Add screenshots demonstrating key features here -->
<!-- Example: ![Chat Interface](images/chat-interface.png) -->

## Known Issues / Limitations

- Large files may be truncated when added to context due to model token limits
- The extension requires an active internet connection to communicate with the Gemini API
- Some complex code structures may not be perfectly understood by the AI

## Release Notes

### 0.1.0

- Initial release of Codexpilot
- Core features: Gemini chat, file context via '@' mentions, code actions
- Markdown rendering with syntax highlighting
- Streaming responses

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the [MIT License](LICENSE).

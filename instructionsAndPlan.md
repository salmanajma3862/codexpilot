# VS Code Gemini Code Buddy Extension: Plan & MVP

## Project Goal

To build a Visual Studio Code extension named "Gemini Code Buddy" (or similar). This extension will allow users to interact with Google's Gemini language model. The key feature is the ability for the user to manually select files from their current workspace to provide relevant codebase context to the Gemini model along with their query. The extension should facilitate code understanding, editing suggestions, and potentially code generation based on the provided context.

## Core Technologies

*   **VS Code Extension API:** Utilizing `vscode` namespace for UI elements, commands, file system access, webviews, secret storage, etc.
*   **TypeScript:** The primary language for extension development.
*   **Webviews:** For creating the custom chat UI within VS Code.
*   **Google Generative AI SDK (`@google/generative-ai`):** For interacting with the Gemini API.
*   **Node.js:** Runtime environment for the extension.

## Minimum Viable Product (MVP) Features

The initial focus is on delivering the core value proposition with minimal complexity. The MVP includes:

1.  **Dedicated UI Panel:**
    *   An icon in the VS Code Activity Bar.
    *   Clicking the icon opens a dedicated View Container in the Sidebar.
    *   This container hosts a single Webview for all interactions.

2.  **Basic Chat Interface (within the Webview):**
    *   **Input Area:** A `textarea` for users to type their queries/prompts.
    *   **Send Button:** To submit the query.
    *   **Chat History Display:** An area to show the conversation flow, clearly distinguishing between 'User' messages and 'Assistant' (Gemini) responses. (Plain text display is sufficient for MVP).

3.  **Manual File Context Management (via Commands):**
    *   **Add Context:** Commands to allow the user to add files to the context:
        *   `Gemini Buddy: Add Active File to Context` (Command Palette, potentially Editor context menu).
        *   `Gemini Buddy: Add File from Explorer to Context` (Explorer context menu for files).
    *   **Clear Context:** A command `Gemini Buddy: Clear Context` (Command Palette) to remove all files from the context.
    *   **Context Display:** The Webview UI should have a *non-interactive* area displaying the list of relative file paths currently included in the context. This list updates when context changes via commands.

4.  **API Key Management (Secure):**
    *   A command `Gemini Buddy: Set API Key` (Command Palette).
    *   This command uses `vscode.window.showInputBox` (with `password: true`) to prompt the user.
    *   The API key is stored securely using VS Code's `SecretStorage` API. **It must NOT be hardcoded or stored insecurely.**

5.  **Basic Gemini API Integration:**
    *   When the user sends a message via the chat interface:
        *   Retrieve the stored API key.
        *   Read the content of all files currently in the context list.
        *   Construct a prompt containing the file contents (clearly marked) and the user's query.
        *   Send the combined prompt to the Gemini API (e.g., `gemini-1.5-flash-latest`).
        *   Display the text response from Gemini in the chat history area of the Webview.
        *   Basic error handling for API key issues or API call failures should be included (e.g., show an error message in the chat).

## Features Excluded from MVP

To maintain focus, the following features are **NOT** part of the initial MVP:

*   Automatic context detection.
*   Selecting code snippets/selections as context (beyond manually copying into the prompt).
*   Direct code application buttons ("Insert Code", "Replace Selection").
*   Streaming LLM responses.
*   Chat history persistence across VS Code sessions.
*   Advanced context handling (summarization, embeddings, RAG).
*   User configuration settings (model selection, temperature, etc.).
*   Syntax highlighting or advanced markdown rendering in chat responses.
*   Folder-level context addition (MVP focuses on individual files).
*   Diff views.

## UI Implementation Plan Summary (MVP)

*   **Location:** Activity Bar Icon -> Sidebar View Container -> Webview.
*   **Webview Layout:**
    *   Top: Simple text list of context file paths (display only, updated by commands).
    *   Middle: Scrollable chat history area (User/Assistant messages).
    *   Bottom: Textarea input + Send button.
*   **Interaction:** Chat via Webview; Context management and API key via VS Code Commands.

## Development Process

We will build this extension incrementally, focusing on one MVP feature area at a time (e.g., UI skeleton first, then context commands, then API integration). This file serves as the authoritative plan and context for AI assistance during development. Refer to this file when asking for help with specific implementation steps.

## Key Files (Expected)

*   `package.json`: Manifest, contributions, dependencies.
*   `src/extension.ts`: Activation logic, command registration, Webview provider registration.
*   `src/ChatViewProvider.ts`: Implements `vscode.WebviewViewProvider`, manages webview lifecycle, communication, and state.
*   `media/main.js`: JavaScript running inside the Webview for UI logic and communication with the extension host.
*   `media/main.css`: CSS for styling the Webview content.
*   `src/geminiApi.ts` (Optional but Recommended): Module for encapsulating Gemini API call logic.
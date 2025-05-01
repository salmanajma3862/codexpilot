/**
 * Interfaces for the Codexpilot extension
 */

/**
 * Interface for a chat message
 */
export interface ChatMessage {
    role: 'user' | 'model';
    parts: [{ text: string }];
}

/**
 * Interface for a saved chat session
 */
export interface SavedChatSession {
    id: string;               // Unique ID (e.g., timestamp string)
    title: string;            // e.g., first user message snippet
    timestamp: number;        // For sorting (e.g., Date.now())
    conversationHistory: ChatMessage[];
    contextUriStrings: string[];
}

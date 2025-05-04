import * as vscode from 'vscode';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, GenerativeModel } from '@google/generative-ai';

// Define the model name
const MODEL_NAME = "gemini-1.5-pro-latest";

/**
 * Get a configured Gemini model instance
 * @param apiKey The Gemini API key
 * @returns A configured GenerativeModel instance
 */
function getGeminiModel(apiKey: string): GenerativeModel {
    if (!apiKey) {
        throw new Error('API key is required. Please set your Gemini API key using the "Codexpilot: Set Gemini API Key" command.');
    }

    console.log("Initializing Gemini API client...");

    // Initialize the API client
    const genAI = new GoogleGenerativeAI(apiKey);

    // Get the generative model
    return genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
        },
        safetySettings: [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
        ],
    });
}

/**
 * Call the Gemini API with the given prompt
 * @param apiKey The Gemini API key
 * @param prompt The prompt to send to the API
 * @returns A promise that resolves to the response text
 */
export async function callGeminiApi(apiKey: string, prompt: string): Promise<string> {
    try {
        const model = getGeminiModel(apiKey);

        console.log("Calling Gemini API...");

        // Generate content
        const result = await model.generateContent(prompt);

        // Check if the response is valid
        if (!result.response) {
            throw new Error('Gemini response is empty.');
        }

        // Check if the response was blocked
        if (result.response.promptFeedback?.blockReason) {
            throw new Error(`Gemini response blocked. Reason: ${result.response.promptFeedback.blockReason}`);
        }

        // Extract the text from the response
        const responseText = result.response.text();

        console.log("Gemini API call successful.");

        return responseText;
    } catch (error: any) {
        handleGeminiError(error);
    }
}

/**
 * Call the Gemini API with streaming response
 * @param apiKey The Gemini API key
 * @param promptOrHistory The prompt string or conversation history to send to the API
 * @param systemInstruction Optional system instruction for the model
 * @param onChunk Callback function to handle each chunk of the response
 * @returns A promise that resolves when the stream is complete
 */
export async function callGeminiApiStream(
    apiKey: string,
    promptOrHistory: string | { role: 'user' | 'model', parts: [{ text: string }] }[],
    systemInstructionOrCallback?: string | ((chunk: string) => void),
    onChunkCallback?: (chunk: string) => void
): Promise<void> {
    // Determine if we're using conversation history or a simple prompt
    const isUsingHistory = typeof promptOrHistory !== 'string';

    // Determine the callback function based on arguments
    const onChunk = onChunkCallback ||
        (typeof systemInstructionOrCallback === 'function' ?
            systemInstructionOrCallback :
            () => {});

    // Determine if we have a system instruction
    const systemInstruction = typeof systemInstructionOrCallback === 'string' ?
        systemInstructionOrCallback :
        undefined;

    // Log the received contents for API call
    if (isUsingHistory) {
        console.log('>>> GeminiAPI: Received contents for API call:', JSON.stringify(promptOrHistory, null, 2));
    } else {
        console.log('>>> GeminiAPI: Received simple prompt string (not conversation history)');
    }

    // Retry configuration
    const MAX_RETRIES = 2; // Total of 3 attempts (initial + 2 retries)
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
        try {
            attempt++;
            console.log(`Calling Gemini API with streaming... (Attempt ${attempt}/${MAX_RETRIES + 1})`);

            const model = getGeminiModel(apiKey);

            // Generate content stream based on input type
            let result;

            if (isUsingHistory) {
                // Using conversation history
                console.log(`>>> GeminiAPI: Using conversation history with ${(promptOrHistory as any[]).length} messages`);

                if (systemInstruction) {
                    // With system instruction
                    console.log('>>> GeminiAPI: Including system instruction:', systemInstruction);
                    result = await model.generateContentStream({
                        contents: promptOrHistory,
                        systemInstruction: systemInstruction
                    });
                } else {
                    // Without system instruction
                    console.log('>>> GeminiAPI: No system instruction provided');
                    result = await model.generateContentStream({
                        contents: promptOrHistory
                    });
                }
            } else {
                // Using simple prompt string
                console.log(">>> GeminiAPI: Using simple prompt string");
                result = await model.generateContentStream(promptOrHistory as string);
            }

            // Process the stream
            let fullResponse = '';

            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                fullResponse += chunkText;

                // Call the callback with the chunk text
                onChunk(chunkText);
            }

            // The response object is available after the stream completes
            const response = await result.response;

            // Check if the response was blocked
            if (response.promptFeedback?.blockReason) {
                throw new Error(`Gemini response blocked. Reason: ${response.promptFeedback.blockReason}`);
            }

            console.log("Gemini API streaming completed successfully.");
            return; // Success, exit the function

        } catch (error: any) {
            console.error(`Gemini API attempt ${attempt} failed:`, error);

            // Determine if this is a retryable error
            const isRetryable = isRetryableError(error);

            if (isRetryable && attempt <= MAX_RETRIES) {
                // Exponential backoff: wait longer for each retry attempt
                const backoffMs = 1000 * attempt; // 1s, 2s, etc.
                console.log(`Retrying Gemini API call in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES})...`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
                continue; // Try again
            } else {
                // Not retryable or max retries reached
                // Categorize the error for better user feedback
                const errorType = categorizeGeminiError(error);
                const errorMessage = `Gemini API Error (${errorType}${attempt > 1 ? ` after ${attempt} attempts` : ''}): ${error.message || 'Unknown error'}`;

                // Log the categorized error
                console.error(errorMessage);

                // Handle the error with our error handler
                handleGeminiError({
                    ...error,
                    message: errorMessage,
                    errorType: errorType
                });
            }
        }
    }
}

/**
 * Determine if an error is potentially retryable
 * @param error The error to check
 * @returns True if the error might be resolved by retrying, false otherwise
 */
function isRetryableError(error: any): boolean {
    const errorMessage = error.message || '';

    // Network errors are often transient and can be retried
    if (
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ENOTFOUND')
    ) {
        return true;
    }

    // Rate limiting might be resolved by waiting
    if (
        errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests') ||
        errorMessage.includes('429')
    ) {
        return true;
    }

    // Server errors might be transient
    if (
        errorMessage.includes('server error') ||
        errorMessage.includes('500') ||
        errorMessage.includes('503')
    ) {
        return true;
    }

    // By default, don't retry
    return false;
}

/**
 * Categorize Gemini API errors for better user feedback
 * @param error The error to categorize
 * @returns A string describing the error category
 */
function categorizeGeminiError(error: any): string {
    const errorMessage = error.message || '';

    // Authentication errors
    if (
        errorMessage.includes('API key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('401') ||
        errorMessage.includes('403')
    ) {
        return 'Authentication';
    }

    // Content safety/moderation errors
    if (
        errorMessage.includes('blocked') ||
        errorMessage.includes('safety') ||
        errorMessage.includes('harmful') ||
        errorMessage.includes('inappropriate')
    ) {
        return 'Content Safety';
    }

    // Rate limiting
    if (
        errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests') ||
        errorMessage.includes('429')
    ) {
        return 'Rate Limit';
    }

    // Network errors
    if (
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ENOTFOUND')
    ) {
        return 'Network';
    }

    // Model errors
    if (
        errorMessage.includes('model') ||
        errorMessage.includes('parameter') ||
        errorMessage.includes('token limit') ||
        errorMessage.includes('context length')
    ) {
        return 'Model Limitation';
    }

    // Server errors
    if (
        errorMessage.includes('server error') ||
        errorMessage.includes('500') ||
        errorMessage.includes('503')
    ) {
        return 'Server';
    }

    // Default
    return 'Unknown';
}

/**
 * Handle errors from the Gemini API
 * @param error The error to handle
 */
function handleGeminiError(error: any): never {
    console.error("Gemini API Error:", error);

    // Get the error type if available, or categorize it
    const errorType = error.errorType || categorizeGeminiError(error);

    // Handle different error types with specific user messages
    switch (errorType) {
        case 'Authentication':
            vscode.window.showErrorMessage(
                'Invalid Gemini API key. Please set a valid API key using the "Codexpilot: Set Gemini API Key" command.',
                'Set API Key'
            ).then(selection => {
                if (selection === 'Set API Key') {
                    vscode.commands.executeCommand('codexpilot.setApiKey');
                }
            });
            throw new Error('Invalid Gemini API key. Please set a valid API key.');

        case 'Content Safety':
            vscode.window.showErrorMessage(
                'The request was blocked by Gemini\'s content safety system. Please modify your query and try again.',
                'Learn More'
            ).then(selection => {
                if (selection === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://ai.google.dev/docs/safety_setting'));
                }
            });
            throw new Error('Content safety: ' + error.message);

        case 'Rate Limit':
            vscode.window.showErrorMessage(
                'Gemini API rate limit reached. Please wait a moment before trying again.',
                'OK'
            );
            throw new Error('Rate limit: ' + error.message);

        case 'Network':
            vscode.window.showErrorMessage(
                'Network error connecting to Gemini API. Please check your internet connection and try again.',
                'OK'
            );
            throw new Error('Network error: ' + error.message);

        case 'Model Limitation':
            vscode.window.showErrorMessage(
                'The request exceeded Gemini model limitations. Try reducing the amount of context or simplifying your query.',
                'OK'
            );
            throw new Error('Model limitation: ' + error.message);

        case 'Server':
            vscode.window.showErrorMessage(
                'Gemini API server error. This is likely a temporary issue, please try again later.',
                'OK'
            );
            throw new Error('Server error: ' + error.message);

        default:
            // Generic error handling for unknown error types
            vscode.window.showErrorMessage(
                `Gemini API error: ${error.message}`,
                'OK'
            );
            throw new Error(`Gemini API Error: ${error.message}`);
    }
}
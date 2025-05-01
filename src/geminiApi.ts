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
    try {
        const model = getGeminiModel(apiKey);

        console.log("Calling Gemini API with streaming...");

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

        // Generate content stream based on input type
        let result;

        if (isUsingHistory) {
            // Using conversation history
            console.log(`Using conversation history with ${promptOrHistory.length} messages`);

            if (systemInstruction) {
                // With system instruction
                result = await model.generateContentStream({
                    contents: promptOrHistory,
                    systemInstruction: systemInstruction
                });
            } else {
                // Without system instruction
                result = await model.generateContentStream({
                    contents: promptOrHistory
                });
            }
        } else {
            // Using simple prompt string
            console.log("Using simple prompt string");
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

    } catch (error: any) {
        handleGeminiError(error);
    }
}

/**
 * Handle errors from the Gemini API
 * @param error The error to handle
 */
function handleGeminiError(error: any): never {
    console.error("Gemini API Error:", error);

    // Check if the error is related to an invalid API key
    if (error.message && (
        error.message.includes('API key') ||
        error.message.includes('authentication') ||
        error.message.includes('401') ||
        error.message.includes('403')
    )) {
        vscode.window.showErrorMessage(
            'Invalid Gemini API key. Please set a valid API key using the "Codexpilot: Set Gemini API Key" command.',
            'Set API Key'
        ).then(selection => {
            if (selection === 'Set API Key') {
                vscode.commands.executeCommand('codexpilot.setApiKey');
            }
        });

        throw new Error('Invalid Gemini API key. Please set a valid API key.');
    }

    // Re-throw with a more informative message
    throw new Error(`Gemini API Error: ${error.message}`);
}
import * as vscode from 'vscode';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Define the model name
const MODEL_NAME = "gemini-1.5-pro-latest";

/**
 * Call the Gemini API with the given prompt
 * @param apiKey The Gemini API key
 * @param prompt The prompt to send to the API
 * @returns A promise that resolves to the response text
 */
export async function callGeminiApi(apiKey: string, prompt: string): Promise<string> {
    if (!apiKey) {
        throw new Error('API key is required. Please set your Gemini API key using the "Codexpilot: Set Gemini API Key" command.');
    }

    try {
        console.log("Initializing Gemini API client...");

        // Initialize the API client
        const genAI = new GoogleGenerativeAI(apiKey);

        // Get the generative model
        const model = genAI.getGenerativeModel({
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
}
import {
    AIProvider,
} from "./aiProvider";

import {
    OllamaProvider,
} from "./ollamaProvider";

export function createAIProvider():
    AIProvider {
    const provider =
        process.env.AI_PROVIDER ||
        "ollama";

    switch (provider) {
        case "ollama":
            return new OllamaProvider(
                process.env.OLLAMA_MODEL ||
                "qwen3:8b",
            );

        default:
            throw new Error(
                `Unsupported AI provider: ${provider}`,
            );
    }
}

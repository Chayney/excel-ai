import { Ollama } from "ollama";

import {
    AIProvider,
    AIMessage,
    AIResponse,
} from "./aiProvider";

export class OllamaProvider
    implements AIProvider {

    private readonly model: string;
    private readonly client: Ollama;

    constructor(
        model =
            process.env.OLLAMA_MODEL ||
            "qwen2.5:3b",
    ) {
        this.model = model;

        const host =
            process.env.OLLAMA_HOST ||
            "http://ollama:11434";

        console.log(
            "[OLLAMA] Host:",
            host,
        );

        console.log(
            "[OLLAMA] Model:",
            this.model,
        );

        this.client =
            new Ollama({
                host,
            });
    }

    async chat(
        messages: AIMessage[],
    ): Promise<AIResponse> {

        const response =
            await this.client.chat({
                model: this.model,

                messages:
                    messages.map(
                        (message) => ({
                            role:
                                message.role,

                            content:
                                message.content,
                        }),
                    ),

                think: false,

                options: {
                    temperature: 0,
                },
            });

        return {
            content:
                response.message
                    .content,
        };
    }
}

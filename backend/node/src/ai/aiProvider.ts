export type AIMessage = {
    role: "system" | "user";
    content: string;
};

export type AIResponse = {
    content: string;
};

export interface AIProvider {
    chat(
        messages: AIMessage[],
    ): Promise<AIResponse>;
}

import { OllamaChatModel } from "beeai-framework/adapters/ollama/backend/chat";
import { ChatModel } from "beeai-framework/backend/chat";

export function getChatModel(): ChatModel {
  if (process.env["OLLAMA_CHAT_MODEL"]) {
    return new OllamaChatModel(
      process.env.OLLAMA_CHAT_MODEL || "granite3.2:8b",
      { numCtx: 128000 },
      {
        baseURL: process.env.OLLAMA_BASE_URL,
        headers: process.env.OLLAMA_HEADERS ? JSON.parse(process.env.OLLAMA_HEADERS) : undefined,
      },
    );
  } else {
    return new OllamaChatModel("granite3.2:8b", { numCtx: 32000 });
  }
}

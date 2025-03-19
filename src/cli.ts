import { UnconstrainedMemory } from "beeai-framework/memory/unconstrainedMemory";
import { createConsoleReader } from "./helpers/reader.js";
import { Workflow } from "beeai-framework/workflows/workflow";
import { BeeCanvasAgent } from "./bee-canvas/agent.js";
import { UserMessage, AssistantMessage } from "beeai-framework/backend/message";
import { OllamaChatModel } from "beeai-framework/adapters/ollama/backend/chat";

const chatModel = new OllamaChatModel(process.env.OLLAMA_CHAT_MODEL);
const workflow = new BeeCanvasAgent(chatModel).getWorkflow();
const memory = new UnconstrainedMemory();
let lastResult = {} as Workflow.output<typeof workflow>;
const reader = createConsoleReader();

for await (const { prompt } of reader) {
  const userMessage = new UserMessage(prompt);
  await memory.add(userMessage);

  const { result } = await workflow
    .run({
      input: prompt,
      output: "",
      artifact: lastResult.artifact,
      memory: memory.asReadOnly(),
    })
    .observe((emitter) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      emitter.on("start", ({ step, run }) => {
        reader.write(`-> ▶️  ${step}`, "");
      });
    });

  lastResult = result;

  reader.write("🤖 Artifact:", `\n${lastResult.artifact || ""}`);
  reader.write("🤖 Response:", lastResult.output || "");

  const assistantMessage = new AssistantMessage(lastResult.output || "");
  await memory.add(assistantMessage);
}

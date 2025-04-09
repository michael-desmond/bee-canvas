import { z } from "zod";
import { Metadata } from "@i-am-bee/beeai-sdk/schemas/metadata";
import { messageInputSchema, messageOutputSchema } from "@i-am-bee/beeai-sdk/schemas/message";
import { Message } from "beeai-framework/backend/message";
import { UnconstrainedMemory } from "beeai-framework/memory/unconstrainedMemory";
import { BeeCanvasAgent } from "../bee-canvas/agent.js";
import { getChatModel } from "src/helpers/model.js";
import { AcpServer } from "@i-am-bee/acp-sdk/server/acp";

const inputSchema = messageInputSchema.extend({
  selectedTextOffset: z.number().optional(),
  selectedTextLength: z.number().optional(),
  artifact: z.string().optional(),
});

const outputSchema = messageOutputSchema.extend({
  artifact: z.string().optional(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const run =
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (server: AcpServer) =>
    async (
      {
        params,
      }: {
        params: { input: Input };
      },

      { signal }: { signal?: AbortSignal },
    ) => {
      const { messages, artifact, selectedTextOffset, selectedTextLength } = params.input;

      // Input passed as first user message
      const memory = new UnconstrainedMemory();
      await memory.addMany(
        messages.slice(0, -1).map(({ role, content }) => Message.of({ role, text: content })),
      );
      const input = messages.at(-1)?.content || "";
      const chatModel = getChatModel();
      const agent = new BeeCanvasAgent(chatModel);

      const { result } = await agent.getWorkflow().run(
        {
          input: input,
          output: "",
          artifact: artifact,
          selectedTextOffset: selectedTextOffset,
          selectedTextLength: selectedTextLength,
          memory: memory.asReadOnly(),
        },
        { signal: signal },
      );

      return {
        messages: [{ role: "assistant", content: result.output || "" }],
        artifact: result.artifact,
      } as Output;
    };

const agentName = "bee-canvas";
const exampleInputText = "Write a topological sort function in python";

export const agent = {
  name: agentName,
  description: `A co-editing agent built using the beeai-framework.`,
  inputSchema,
  outputSchema,
  run,
  metadata: {
    fullDescription: `A co-editing agent built using the beeai-framework.
## ✨ Key Features

- Generate & update co-editable artifacts (Markdown & Code)
- Implemented using Bee Workflows 💪
`,
    framework: "BeeAI",
    license: "Apache 2.0",
    languages: ["TypeScript"],
    examples: {
      cli: [],
    },
    ui: {
      type: "custom",
      userGreeting: "Ask the agent to help you write a document or some code.",
    },
    githubUrl: "https://github.com/michael-desmond/bee-canvas",
    exampleInput: exampleInputText,
    avgRunTimeSeconds: 19,
    avgRunTokens: 5409,
  } satisfies Metadata,
};

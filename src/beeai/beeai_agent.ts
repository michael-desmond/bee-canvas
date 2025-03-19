import { z } from "zod";
import { Metadata } from "@i-am-bee/beeai-sdk/schemas/metadata";
import { messageInputSchema, messageOutputSchema } from "@i-am-bee/beeai-sdk/schemas/message";
import { Message } from "beeai-framework/backend/message";
import { UnconstrainedMemory } from "beeai-framework/memory/unconstrainedMemory";
import { BeeCanvasAgent } from "../bee-canvas/agent.js";
import { OllamaChatModel } from "beeai-framework/adapters/ollama/backend/chat";

const inputSchema = messageInputSchema.extend({
  artifact: z.string().optional(),
});

const outputSchema = messageOutputSchema.extend({
  artifact: z.string().optional(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const run = async (
  {
    params,
  }: {
    params: { input: Input };
  },

  { signal }: { signal?: AbortSignal },
) => {
  const { messages, artifact } = params.input;
  const memory = new UnconstrainedMemory();
  await memory.addMany(
    messages.slice(0, -1).map(({ role, content }) => Message.of({ role, text: content })),
  );
  const input = messages.at(-1)?.content || "";
  const chatModel = new OllamaChatModel(process.env.OLLAMA_CHAT_MODEL || "granite3.2:8b");
  const agent = new BeeCanvasAgent(chatModel);

  const { result } = await agent.getWorkflow().run(
    {
      input: input,
      output: "",
      artifact: artifact,
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

// const exampleInput: Input = {
//     messages: [{ role: "user", content: exampleInputText }],
// };
// const exampleOutputText: string = `Your topological sort function is ready! It's a Python implementation that performs a depth-first search on a directed acyclic graph. Please review and let me know if any adjustments are needed.`;
const exampleOutputArtifact = `def topological_sort(graph):
    """
    Perform a topological sort on the given directed acyclic graph.
    
    Args:
        graph (dict): A dictionary representing the graph where keys are nodes and values are lists of nodes that depend on the key node.
    
    Returns:
        list: A list of nodes in topologically sorted order.
    """
    # Initialize a stack and an empty set to keep track of visited nodes
    stack = []
    visited = set()

    def dfs(node):
        # If the node has already been visited, skip it
        if node in visited:
            return

        # Mark the node as visited
        visited.add(node)

        # Visit all nodes that depend on the current node
        for neighbor in graph.get(node, []):
            dfs(neighbor)

        # Push the current node onto the stack
        stack.append(node)

    # Perform DFS from each unvisited node
    for node in graph:
        if node not in visited:
            dfs(node)

    # The topologically sorted order is the reverse of the stack
    return stack[::-1]`;

// const exampleOutput: Output = {
//     messages: [{ role: "user", content: exampleInputText }],
//     artifact: exampleOutputArtifact,
//     logs: []
// };

const processingSteps = [
  "Analyzes the provided source code to extract key features and functionality",
  "Formats the extracted information into a structured documentation template",
  "Simulates an interactive discussion to ensure the output adheres to the documentation standards",
];

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
      cli: [
        {
          command: `beeai run ${agentName} "${exampleInputText}"`,
          output: exampleOutputArtifact,
          processingSteps,
        },
      ],
    },
    ui: {
      type: "chat",
      userGreeting: "Ask the agent to help you write a document or some code.",
    },
    githubUrl: "https://github.com/michael-desmond/bee-canvas",
    exampleInput: exampleInputText,
    avgRunTimeSeconds: 19,
    avgRunTokens: 5409,
  } satisfies Metadata,
};

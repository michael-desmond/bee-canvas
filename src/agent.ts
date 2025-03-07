import "dotenv/config";
import { z } from "zod";
import { Workflow } from "beeai-framework/workflows/workflow";
import { ReadOnlyMemory } from "beeai-framework/memory/base";
import { AssistantMessage, UserMessage } from "beeai-framework/backend/message";
import { OllamaChatModel } from "beeai-framework/adapters/ollama/backend/chat";

import {
  AGENT_CONTEXT,
  FOLLOW_UP,
  NEW_ARTIFACT_PROMPT,
  REPLY_GENERAL,
  ROUTE_QUERY_OPTIONS_HAS_ARTIFACTS,
  ROUTE_QUERY_OPTIONS_NO_ARTIFACTS,
  ROUTE_QUERY_TEMPLATE,
  UPDATE_ARTIFACT_PROMPT,
} from "./prompts.js";
import { UnconstrainedMemory } from "beeai-framework/memory/unconstrainedMemory";
import { createConsoleReader } from "./helpers/reader.js";

const workflowSchema = z.object({
  input: z.string(),
  output: z.string().optional(),
  artifact: z.string().optional(),
  memory: z.instanceof(ReadOnlyMemory),
});

const STEPS = {
  routeUserMessage: "routeUserMessage" as const,
  generateArtifact: "generateArtifact" as const,
  rewriteArtifact: "rewriteArtifact" as const,
  followUpArtifact: "followUpArtifact" as const,
  replyToGeneralInput: "replyToGeneralInput" as const,
};

const model = new OllamaChatModel("granite3.2:8b");

const workflow = new Workflow({
  schema: workflowSchema,
  outputSchema: workflowSchema.required({ output: true }),
});

workflow.addStep(STEPS.routeUserMessage, async (state) => {
  const recentMessages = state.memory.messages.map((msg) => `${msg.role}: ${msg.text}`).join("\n");

  // Conditionally choose the routes
  const options = state.artifact
    ? ROUTE_QUERY_OPTIONS_HAS_ARTIFACTS
    : ROUTE_QUERY_OPTIONS_NO_ARTIFACTS;
  const prompt = ROUTE_QUERY_TEMPLATE.render({
    context: AGENT_CONTEXT,
    options: options,
    query: state.input,
    recentMessages: recentMessages,
  });

  const schema = state.artifact
    ? z.union([z.literal("rewriteArtifact"), z.literal("replyToGeneralInput")])
    : z.union([z.literal("generateArtifact"), z.literal("replyToGeneralInput")]);

  const { object } = await model.createStructure({
    schema: schema,
    messages: [new UserMessage(prompt)],
  });

  return object;
});

workflow.addStep(STEPS.generateArtifact, async (state) => {
  const recentMessages = state.memory.messages.map((msg) => `${msg.role}: ${msg.text}`).join("\n");

  const prompt = NEW_ARTIFACT_PROMPT.render({
    context: AGENT_CONTEXT,
    recentMessages: recentMessages,
    request: state.input,
  });

  const response = await model.createStructure({
    schema: z.object({
      artifact: z.string().describe("The artifact content."),
    }),
    messages: [new UserMessage(prompt)],
  });

  state.artifact = response.object.artifact;
  return STEPS.followUpArtifact;
});

workflow.addStep(STEPS.rewriteArtifact, async (state) => {
  const prompt = UPDATE_ARTIFACT_PROMPT.render({
    context: AGENT_CONTEXT,
    artifact: state.artifact,
    request: state.input,
  });

  const response = await model.createStructure({
    schema: z.object({
      artifact: z.string().describe("The updated artifact."),
    }),
    messages: [new UserMessage(prompt)],
  });

  state.artifact = response.object.artifact;
  return STEPS.followUpArtifact;
});

workflow.addStep(STEPS.replyToGeneralInput, async (state) => {
  const recentMessages = state.memory.messages.map((msg) => `${msg.role}: ${msg.text}`).join("\n");
  const prompt = REPLY_GENERAL.render({
    context: AGENT_CONTEXT,
    artifact: state.artifact,
    recentMessages: recentMessages,
    request: state.input,
  });

  const response = await model.createStructure({
    schema: z.object({
      response: z.string().describe("Response to the user's request."),
    }),
    messages: [new UserMessage(prompt)],
  });

  state.output = response.object.response;
  return Workflow.END;
});

workflow.addStep(STEPS.followUpArtifact, async (state) => {
  const recentMessages = state.memory.messages.map((msg) => `${msg.role}: ${msg.text}`).join("\n");
  const prompt = FOLLOW_UP.render({
    artifact: state.artifact,
    recentMessages: recentMessages,
    request: state.input,
  });

  const response = await model.createStructure({
    schema: z.object({
      response: z.string().describe("The follow up message."),
    }),
    messages: [new UserMessage(prompt)],
  });

  state.output = response.object.response;
  return Workflow.END;
});

const memory = new UnconstrainedMemory();
let lastResult = {} as Workflow.output<typeof workflow>;
const reader = createConsoleReader();

for await (const { prompt } of reader) {
  const userMessage = new UserMessage(prompt);
  await memory.add(userMessage);

  const { result } = await workflow
    .run({
      input: prompt,
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

  reader.write("🤖 Artifact:", `\n\n${lastResult.artifact!}\n`);
  reader.write("🤖 Response:", lastResult.output);

  const assistantMessage = new AssistantMessage(lastResult.output);

  await memory.add(assistantMessage);
}

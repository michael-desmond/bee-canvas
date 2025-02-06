import "dotenv/config";
import { z } from "zod";
import { Workflow } from "bee-agent-framework/experimental/workflows/workflow";
import { UnconstrainedMemory } from "bee-agent-framework/memory/unconstrainedMemory";
import { createConsoleReader } from "./helpers/io.js";
import { BaseMessage, Role } from "bee-agent-framework/llms/primitives/message";
import { JsonDriver } from "bee-agent-framework/llms/drivers/json";
import { getChatLLM } from "./helpers/llm.js";
import { ReadOnlyMemory } from "bee-agent-framework/memory/base";
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

const schema = z.object({
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

const workflow = new Workflow({
  schema,
  outputSchema: schema.required({ output: true }),
})
  .addStep(STEPS.routeUserMessage, async (state) => {
    const driver = new JsonDriver(getChatLLM());
    const recentMessages = state.memory.messages
      .map((msg) => `${msg.role}: ${msg.text}`)
      .join("\n");

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
    const { parsed } = await driver.generate(schema, [
      BaseMessage.of({
        role: Role.USER,
        text: prompt,
      }),
    ]);
    return { next: parsed };
  })
  .addStep(STEPS.generateArtifact, async (state) => {
    const driver = new JsonDriver(getChatLLM());
    const recentMessages = state.memory.messages
      .map((msg) => `${msg.role}: ${msg.text}`)
      .join("\n");
    const prompt = NEW_ARTIFACT_PROMPT.render({
      context: AGENT_CONTEXT,
      recentMessages: recentMessages,
      request: state.input,
    });

    const { parsed } = await driver.generate(
      z.object({
        artifact: z.string().describe("The artifact content."),
      }),
      [
        BaseMessage.of({
          role: Role.USER,
          text: prompt,
        }),
      ],
    );

    return { update: { artifact: parsed.artifact }, next: STEPS.followUpArtifact };
  })
  .addStep(STEPS.rewriteArtifact, async (state) => {
    const driver = new JsonDriver(getChatLLM());
    const prompt = UPDATE_ARTIFACT_PROMPT.render({
      context: AGENT_CONTEXT,
      artifact: state.artifact,
      request: state.input,
    });

    const { parsed } = await driver.generate(
      z.object({
        artifact: z.string().describe("The updated artifact."),
      }),
      [
        BaseMessage.of({
          role: Role.USER,
          text: prompt,
        }),
      ],
    );

    return { update: { artifact: parsed.artifact }, next: STEPS.followUpArtifact };
  })
  .addStep(STEPS.replyToGeneralInput, async (state) => {
    const driver = new JsonDriver(getChatLLM());
    const recentMessages = state.memory.messages
      .map((msg) => `${msg.role}: ${msg.text}`)
      .join("\n");
    const prompt = REPLY_GENERAL.render({
      context: AGENT_CONTEXT,
      artifact: state.artifact,
      recentMessages: recentMessages,
      request: state.input,
    });

    const { parsed } = await driver.generate(
      z.object({
        response: z.string().describe("Response to the user's request."),
      }),
      [
        BaseMessage.of({
          role: Role.USER,
          text: prompt,
        }),
      ],
    );
    return { update: { output: parsed.response }, next: Workflow.END };
  })
  .addStep(STEPS.followUpArtifact, async (state) => {
    const driver = new JsonDriver(getChatLLM());
    const recentMessages = state.memory.messages
      .map((msg) => `${msg.role}: ${msg.text}`)
      .join("\n");
    const prompt = FOLLOW_UP.render({
      artifact: state.artifact,
      recentMessages: recentMessages,
      request: state.input,
    });

    const { parsed } = await driver.generate(
      z.object({
        response: z.string().describe("The follup message."),
      }),
      [
        BaseMessage.of({
          role: Role.USER,
          text: prompt,
        }),
      ],
    );
    return { update: { output: parsed.response }, next: Workflow.END };
  });

const memory = new UnconstrainedMemory();
let lastResult = {} as Workflow.output<typeof workflow>;
const reader = createConsoleReader();

for await (const { prompt } of reader) {
  const userMessage = BaseMessage.of({
    role: Role.USER,
    text: prompt,
  });
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
        reader.write(`-> ▶️ ${step}`, "");
      });
    });

  lastResult = result;

  reader.write("🤖 Artifact:", lastResult.artifact!);
  reader.write("🤖 Response:", lastResult.output);

  const assistantMessage = BaseMessage.of({
    role: Role.ASSISTANT,
    text: lastResult.output,
  });

  await memory.add(assistantMessage);
}

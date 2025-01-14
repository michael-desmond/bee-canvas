import "dotenv/config";
import { z } from "zod";
import { Workflow } from "bee-agent-framework/experimental/workflows/workflow";
import { UnconstrainedMemory } from "bee-agent-framework/memory/unconstrainedMemory";
import { createConsoleReader } from "./helpers/io.js";
import { BaseMessage, Role } from "bee-agent-framework/llms/primitives/message";
import { JsonDriver } from "bee-agent-framework/llms/drivers/json";
import { getChatLLM } from "./helpers/llm.js";
import { ReadOnlyMemory } from "bee-agent-framework/memory/base";

const APP_CONTEXT = `The name of the application is "Open Canvas". Open Canvas is a web application where users have a chat window and a canvas to display an artifact.
Artifacts can be any sort of writing content, emails, code, or other creative writing work. Think of artifacts as content, or writing you might find on you might find on a blog, Google doc, or other writing platform.
Users only have a single artifact per conversation, however they have the ability to go back and fourth between artifact edits/revisions.
If a user asks you to generate something completely different from the current artifact, you may do this, as the UI displaying the artifacts will be updated to show whatever they've requested.
Even if the user goes from a 'text' artifact to a 'code' artifact.`;

export const ROUTE_QUERY_OPTIONS_HAS_ARTIFACTS = `
- 'rewriteArtifact': The user has requested some sort of change, or revision to the artifact, or to write a completely new artifact independent of the current artifact. Use their recent message and the currently selected artifact (if any) to determine what to do. You should ONLY select this if the user has clearly requested a change to the artifact.
  It is very important you do not edit the artifact unless clearly requested by the user.
- 'replyToGeneralInput': The user submitted a general input which does not require making an update, edit or generating a new artifact. This should ONLY be used if you are ABSOLUTELY sure the user does NOT want to make an edit, update or generate a new artifact.`;

const ROUTE_QUERY_OPTIONS_NO_ARTIFACTS = `
- 'generateArtifact': The user has inputted a request which requires generating an artifact.
- 'replyToGeneralInput': The user submitted a general input which does not require making an update, edit or generating a new artifact. This should ONLY be used if you are ABSOLUTELY sure the user does NOT want to make an edit, update or generate a new artifact.`;

// const DEFAULT_CODE_PROMPT_RULES = `- Do NOT include triple backticks when generating code. The code should be in plain text.`;

const schema = z.object({
  input: z.string(),
  output: z.string().optional(),
  artifact: z.string().optional(),
  memory: z.instanceof(ReadOnlyMemory),
});

const workflow = new Workflow({
  schema,
  outputSchema: schema.required({ output: true }),
})
  .addStep("routeUserMessage", async (state) => {
    const llm = getChatLLM();
    const driver = new JsonDriver(llm);

    let prompt = "";
    let schema = null;

    if (state.artifact) {
      prompt = `
You are an assistant tasked with routing the users query based on their most recent message.
You should look at this message in isolation and determine where to best route there query.

Use this context about the application and its features when determining where to route to:
${APP_CONTEXT}

Your options are as follows:
<options>
${ROUTE_QUERY_OPTIONS_HAS_ARTIFACTS}
</options>

User query:
${state.input}`;

      schema = z.union([z.literal("rewriteArtifact"), z.literal("replyToGeneralInput")]);
    } else {
      prompt = `
You are an assistant tasked with routing the users query based on their most recent message.
You should look at this message in isolation and determine where to best route there query.

Use this context about the application and its features when determining where to route to:
${APP_CONTEXT}

Your options are as follows:
<options>
${ROUTE_QUERY_OPTIONS_NO_ARTIFACTS}
</options>

User query:
${state.input}`;

      schema = z.union([z.literal("generateArtifact"), z.literal("replyToGeneralInput")]);
    }

    const { parsed } = await driver.generate(schema, [
      BaseMessage.of({
        role: `user`,
        text: prompt,
      }),
    ]);

    return { next: parsed };
  })
  .addStep("generateArtifact", async (state) => {
    const llm = getChatLLM();
    const driver = new JsonDriver(llm);

    const NEW_ARTIFACT_PROMPT = `You are an AI assistant tasked with generating a new artifact based on the users request.
Ensure you use markdown syntax when appropriate, as the text you generate will be rendered in markdown.

Follow these rules and guidelines:
<rules-guidelines>
- Do not wrap the artifact in any XML tags you see in this prompt.
- If writing code, do not add inline comments unless the user has specifically requested them. This is very important as we don't want to clutter the code.
- Ensure you ONLY reply with the rewritten artifact and NO other content.
</rules-guidelines>

User request:
${state.input}`;

    const { parsed } = await driver.generate(
      z.object({
        artifact: z.string().describe("The artifact content."),
      }),
      [
        BaseMessage.of({
          role: `user`,
          text: NEW_ARTIFACT_PROMPT,
        }),
      ],
    );

    return { update: { artifact: parsed.artifact }, next: "followUpArtifact" };
  })
  .addStep("rewriteArtifact", async (state) => {
    const llm = getChatLLM();
    const driver = new JsonDriver(llm);

    const NEW_ARTIFACT_PROMPT = `You are an AI assistant, and the user has requested you make an update to an artifact you generated in the past.

Here is the current content of the artifact:
<artifact>
${state.artifact}
</artifact>

Please update the artifact based on the user's request.

Follow these rules and guidelines:
<rules-guidelines>
- You should respond with the ENTIRE updated artifact, with no additional text before and after.
- Do not wrap it in any XML tags you see in this prompt.
- You should use proper markdown syntax when appropriate, as the text you generate will be rendered in markdown. UNLESS YOU ARE WRITING CODE.
- When you generate code, a markdown renderer is NOT used so if you respond with code in markdown syntax, or wrap the code in tipple backticks it will break the UI for the user.
- If generating code, it is imperative you never prefix/suffix it with plain text. Ensure you ONLY respond with the code.
</rules-guidelines>

User Request: 
${state.input}`;

    const { parsed } = await driver.generate(
      z.object({
        artifact: z.string().describe("The updated artifact."),
      }),
      [
        BaseMessage.of({
          role: `user`,
          text: NEW_ARTIFACT_PROMPT,
        }),
      ],
    );

    return { update: { artifact: parsed.artifact }, next: "followUpArtifact" };
  })
  .addStep("replyToGeneralInput", async (state) => {
    const llm = getChatLLM();
    const driver = new JsonDriver(llm);
    const conversation = state.memory.messages.map((msg) => `${msg.role}: ${msg.text}`).join("\n");

    const REPLY_GENERAL_PROMPT = `You are an AI assistant tasked with responding to the users request. Limit the response to 2 to 3 sentences.

Use this context about the application and its features if necessary:
${APP_CONTEXT}

Here is the current content of the artifact:
<artifact>
${state.artifact}
</artifact>

Finally, here is the chat history between you and the user:
<conversation>
${conversation}
</conversation>

User request:
${state.input}`;

    const { parsed } = await driver.generate(
      z.object({
        response: z.string().describe("Response to user request."),
      }),
      [
        BaseMessage.of({
          role: `user`,
          text: REPLY_GENERAL_PROMPT,
        }),
      ],
    );

    return { update: { output: parsed.response }, next: Workflow.END };
  })
  .addStep("followUpArtifact", async (state) => {
    const llm = getChatLLM();
    const driver = new JsonDriver(llm);

    const conversation = state.memory.messages.map((msg) => `${msg.role}: ${msg.text}`).join("\n");

    const FOLLOWUP_ARTIFACT_PROMPT = `You are an AI assistant tasked with generating a followup to the artifact the user just generated.
The context is you're having a conversation with the user, and you've just generated an artifact for them. Now you should follow up with a message that notifies them you're done. Make this message creative!

I've provided some examples of what your followup might be, but please feel free to get creative here!

<examples>

<example id="1">
Here's a comedic twist on your poem about Bernese Mountain dogs. Let me know if this captures the humor you were aiming for, or if you'd like me to adjust anything!
</example>

<example id="2">
Here's a poem celebrating the warmth and gentle nature of pandas. Let me know if you'd like any adjustments or a different style!
</example>

<example id="3">
Does this capture what you had in mind, or is there a different direction you'd like to explore?
</example>

</examples>

Here is the artifact you generated:
<artifact>
${state.artifact}
</artifact>

Finally, here is the chat history between you and the user:
<conversation>
${conversation}
</conversation>

This message should be very short. Never generate more than 2-3 short sentences. Your tone should be somewhat formal, but still friendly. Remember, you're an AI assistant.

Do NOT include any tags, or extra text before or after your response. Do NOT prefix your response. Your response to this message should ONLY contain the description/followup message.`;

    const { parsed } = await driver.generate(
      z.object({
        response: z.string().describe("Response to user request."),
      }),
      [
        BaseMessage.of({
          role: `user`,
          text: FOLLOWUP_ARTIFACT_PROMPT,
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
    meta: { createdAt: new Date() },
  });
  await memory.add(userMessage);

  const { result } = await workflow
    .run({
      input: prompt,
      artifact: lastResult.artifact,
      memory: memory.asReadOnly(),
    })
    .observe((emitter) => {
      emitter.on("start", ({ step, run }) => {
        reader.write(`-> ▶️ ${step}`, JSON.stringify(run.state).substring(0, 200).concat("..."));
      });
    });

  lastResult = result;

  reader.write("🤖 Artifact", lastResult.artifact!);
  reader.write("🤖 Answer", lastResult.output);

  const assistantMessage = BaseMessage.of({
    role: Role.ASSISTANT,
    text: lastResult.output,
    meta: { createdAt: new Date() },
  });

  await memory.add(assistantMessage);
}

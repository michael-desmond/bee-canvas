import "dotenv/config";
import { z } from "zod";
import { Workflow } from "beeai-framework/workflows/workflow";
import { ReadOnlyMemory } from "beeai-framework/memory/base";
import { UserMessage } from "beeai-framework/backend/message";

import {
  AGENT_CONTEXT,
  FOLLOW_UP,
  NEW_ARTIFACT_PROMPT,
  REPLY_GENERAL,
  ROUTE_QUERY_OPTIONS_HAS_ARTIFACTS,
  ROUTE_QUERY_OPTIONS_NO_ARTIFACTS,
  ROUTE_QUERY_TEMPLATE,
  UPDATE_ARTIFACT_PROMPT,
  UPDATE_HIGHLIGHTED_TEXT_PROMPT,
} from "./prompts.js";
import { ChatModel } from "beeai-framework";
import { tagSelectedMarkdownByOffset } from "./util.js";

export class BeeCanvasAgent {
  static STEPS = {
    routeUserMessage: "routeUserMessage" as const,
    generateArtifact: "generateArtifact" as const,
    rewriteArtifact: "rewriteArtifact" as const,
    followUpArtifact: "followUpArtifact" as const,
    updateSelectedText: "updateSelectedText" as const,
    replyToGeneralInput: "replyToGeneralInput" as const,
  };

  private workflowSchema = z.object({
    input: z.string(),
    output: z.string(),
    selectedTextOffset: z.number().optional(),
    selectedTextLength: z.number().optional(),
    artifact: z.string().optional(),
    artifact_title: z.string().optional(),
    memory: z.instanceof(ReadOnlyMemory),
  });

  private chatModel: ChatModel;
  private workflow: Workflow<typeof this.workflowSchema>;

  constructor(chatModel: ChatModel) {
    this.chatModel = chatModel;
    this.workflow = new Workflow({
      schema: this.workflowSchema,
      outputSchema: this.workflowSchema.required({ output: true }),
    });

    this.workflow.addStep(BeeCanvasAgent.STEPS.routeUserMessage, async (state) => {
      if (state.artifact && state.selectedTextOffset && state.selectedTextLength) {
        return BeeCanvasAgent.STEPS.updateSelectedText;
      }

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

      const { object } = await this.chatModel.createStructure({
        schema: schema,
        messages: [new UserMessage(prompt)],
      });

      return object;
    });

    this.workflow.addStep(BeeCanvasAgent.STEPS.generateArtifact, async (state) => {
      const recentMessages = state.memory.messages
        .map((msg) => `${msg.role}: ${msg.text}`)
        .join("\n");

      const prompt = NEW_ARTIFACT_PROMPT.render({
        context: AGENT_CONTEXT,
        recentMessages: recentMessages,
        request: state.input,
      });

      const response = await this.chatModel.createStructure({
        schema: z.object({
          title: z.string().describe("The title of the artifact."),
          artifact: z.string().describe("The artifact content."),
        }),
        messages: [new UserMessage(prompt)],
      });

      state.artifact = response.object.artifact;
      state.artifact_title = response.object.title;

      return BeeCanvasAgent.STEPS.followUpArtifact;
    });

    this.workflow.addStep(BeeCanvasAgent.STEPS.rewriteArtifact, async (state) => {
      const prompt = UPDATE_ARTIFACT_PROMPT.render({
        context: AGENT_CONTEXT,
        artifact: state.artifact,
        artifact_title: state.artifact_title,
        request: state.input,
      });

      const response = await this.chatModel.createStructure({
        schema: z.object({
          title: z.string().describe("The title of the artifact."),
          artifact: z.string().describe("The updated artifact."),
        }),
        messages: [new UserMessage(prompt)],
      });

      state.artifact = response.object.artifact;
      state.artifact_title = response.object.title;
      return BeeCanvasAgent.STEPS.followUpArtifact;
    });

    this.workflow.addStep(BeeCanvasAgent.STEPS.updateSelectedText, async (state) => {
      if (state.artifact && state.selectedTextOffset && state.selectedTextLength) {
        const artifactWithSelection = tagSelectedMarkdownByOffset(
          state.artifact,
          state.selectedTextOffset,
          state.selectedTextLength,
          "selected",
        );

        const prompt = UPDATE_HIGHLIGHTED_TEXT_PROMPT.render({
          artifactWithSelection: artifactWithSelection,
          selectedText: state.artifact.slice(
            state.selectedTextOffset,
            state.selectedTextOffset + state.selectedTextLength,
          ),
          request: state.input,
        });

        const response = await this.chatModel.createStructure({
          schema: z.object({
            updatedDocument: z.string().describe("The updated document."),
          }),
          messages: [new UserMessage(prompt)],
        });

        state.artifact = response.object.updatedDocument;
        return BeeCanvasAgent.STEPS.followUpArtifact;
      }
    });

    this.workflow.addStep(BeeCanvasAgent.STEPS.replyToGeneralInput, async (state) => {
      const recentMessages = state.memory.messages
        .map((msg) => `${msg.role}: ${msg.text}`)
        .join("\n");
      const prompt = REPLY_GENERAL.render({
        context: AGENT_CONTEXT,
        artifact_title: state.artifact_title,
        artifact: state.artifact,
        recentMessages: recentMessages,
        request: state.input,
      });

      const response = await this.chatModel.createStructure({
        schema: z.object({
          response: z.string().describe("Response to the user's request."),
        }),
        messages: [new UserMessage(prompt)],
      });

      state.output = response.object.response;
      return Workflow.END;
    });

    this.workflow.addStep(BeeCanvasAgent.STEPS.followUpArtifact, async (state) => {
      const recentMessages = state.memory.messages
        .map((msg) => `${msg.role}: ${msg.text}`)
        .join("\n");
      const prompt = FOLLOW_UP.render({
        context: AGENT_CONTEXT,
        artifact_title: state.artifact,
        artifact: state.artifact,
        recentMessages: recentMessages,
        request: state.input,
      });

      const response = await this.chatModel.createStructure({
        schema: z.object({
          response: z.string().describe("The follow up message."),
        }),
        messages: [new UserMessage(prompt)],
      });

      state.output = response.object.response;
      return Workflow.END;
    });
  }

  getWorkflow(): typeof this.workflow {
    return this.workflow;
  }
}

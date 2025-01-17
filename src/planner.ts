import "dotenv/config";
import { z } from "zod";
import { Workflow } from "bee-agent-framework/experimental/workflows/workflow";
import { UnconstrainedMemory } from "bee-agent-framework/memory/unconstrainedMemory";
import { createConsoleReader } from "./helpers/io.js";
import { BaseMessage, Role } from "bee-agent-framework/llms/primitives/message";
import { JsonDriver } from "bee-agent-framework/llms/drivers/json";
import { getChatLLM } from "./helpers/llm.js";
import { ReadOnlyMemory } from "bee-agent-framework/memory/base";
import { PromptTemplate } from "bee-agent-framework";
import { SearxngTool, SearxngToolOutput } from "./tools/searxng.js";

const PLANNER_PROMPT = new PromptTemplate({
  schema: z.object({
    query: z.string(),
  }),
  template: `You are planning agent. 
For the given user query come up with a minimal step by step plan that will result in a correct solution.
You will not execute the steps yourself, instead you will provide the steps to specialized agents who will execute them on your behalf.
Each step in the plan should be specific and concise, and should be tailored to the capabilities of a specific agent. 
Avoid superflous steps and do not skip steps.

You can assign steps to the following agents. Try to assign steps to the most appropriate agent. You can assign multiple steps to each agent.
1. InternetSearchAgent: This agent is capable of searching the internet for a specific topic.
2. ResearchAgent: This agent can research and summarize information.

User query: {{query}}`,
});

const SEARCH_AGENT_PROMPT = new PromptTemplate({
  schema: z.object({
    task: z.string(),
  }),
  template: `You are an expert at creating precise, complete, and accurate web search queries. 
When given a task, you will generate a fully formed, optimized search query that can be used directly in a search engine to find the most relevant information.

Tips for good search queries: 
- Keep search terms general i.e. use terms like latest or current rather than providing specific dates (unless specified in the task).
- Try not to be overly specific, this may limit the scope of the results.

Task: {{task}}
`,
});

const RESEARCH_AGENT_PROMPT = new PromptTemplate({
  schema: z.object({
    task: z.string(),
    context: z.string(),
  }),
  template: `You are an AI research assistant.
When you receive a task, figure out a solution and provide a final answer. The message will be accompanied with contextual information. Use the contextual information to help you provide a solution.
Make sure to provide a thorough answer that directly addresses the task you received.

Contextual Information:
{{context}}

Task: {{task}}
`,
});

// const RESEARCH_AGENT_PROMPT = new PromptTemplate({
//   schema: z.object({
//     task: z.string(),
//     originalPlan: z.string(),
//     completedSteps: z.string(),
//   }),
//   template: `You are planning agent.
// For the given user query come up with a minimal step by step plan that will result in a solution.
// You will not execute the steps yourself, but provide the steps to specialized agents who will execute them on your behalf.
// Each step in the plan should be specific and concise, and should be tailored to a specific agent.
// Avoid superflous steps and do not skip steps.

// You can assign steps to the following agents. Try to assign steps to the most appropriate agent. You can assign multiple steps to each agent.
// 1. InternetSearchAgent: This agent can search the internet and provide results.
// 2. ResearchAgent: This agent can synthesize and summarize information.

// Your objective was this:
// {{task}}

// Your original plan was this:
// {plan}

// You have currently done the follow steps:
// {past_steps}

// Update your plan accordingly. If no more steps are needed and you can return to the user, then respond with that. Otherwise, fill out the plan. Only add steps to the plan that still NEED to be done. Do not return previously done steps as part of the plan.
// `
// });

const agentSchema = z.union([z.literal("InternetSearchAgent"), z.literal("ResearchAgent")]);

const schema = z.object({
  input: z.string(),
  output: z.string().optional(),
  plan: z
    .array(
      z.object({
        agent: agentSchema,
        step: z.string(),
        solution: z.string().optional(),
      }),
    )
    .optional(),
  memory: z.instanceof(ReadOnlyMemory),
});

const workflow = new Workflow({
  schema,
  outputSchema: schema.required({ output: true }),
})
  .addStep("plan", async (state) => {
    const driver = new JsonDriver(getChatLLM());
    const { parsed } = await driver.generate(
      z.object({
        plan: z.array(
          z.object({
            agent: agentSchema,
            step: z.string(),
          }),
        ),
      }),
      [
        BaseMessage.of({
          role: `user`,
          text: PLANNER_PROMPT.render({ query: state.input }),
        }),
      ],
    );

    console.log(parsed.plan.map((step) => step.step));

    return { update: { plan: parsed.plan, output: "" }, next: "executor" };
  })
  .addStep("executor", async (state) => {
    // Get the index of the next unsolved step
    const index = state.plan?.findIndex((obj) => obj.solution === undefined);
    const nextStep = index !== undefined && index >= 0 ? state.plan?.[index] : undefined;

    if (nextStep) {
      const previousStep = index !== undefined && index > 0 ? state.plan?.[index - 1] : undefined;
      const driver = new JsonDriver(getChatLLM());

      switch (nextStep.agent) {
        case "InternetSearchAgent": {
          const { parsed } = await driver.generate(
            z.object({
              search_query: z.string(),
            }),
            [
              BaseMessage.of({
                role: `user`,
                text: SEARCH_AGENT_PROMPT.render({ task: nextStep.step }),
              }),
            ],
          );

          console.log(parsed.search_query);

          const toolOutput: SearxngToolOutput = await new SearxngTool().run({
            query: parsed.search_query,
          });
          nextStep.solution = JSON.stringify(toolOutput.results, null, 4);
          return { update: { plan: state.plan }, next: "executor" };
        }
        case "ResearchAgent": {
          const { parsed } = await driver.generate(
            z.object({
              result: z.string(),
            }),
            [
              BaseMessage.of({
                role: `user`,
                text: RESEARCH_AGENT_PROMPT.render({
                  task: nextStep.step,
                  context: previousStep?.solution,
                }),
              }),
            ],
          );
          nextStep.solution = parsed.result;
          return { update: { plan: state.plan }, next: "executor" };
        }
        default:
          break;
      }
    }

    const lastStep = state.plan?.[state.plan?.length - 1];
    return { update: { output: lastStep?.solution }, next: Workflow.END };
  });
// .addStep("executor", async (state) => {

//   // Get the index of the next unsolved step
//   const index = state.plan?.findIndex(obj => obj.solution === undefined);
//   const nextStep = (index!==undefined && index >= 0)?state.plan?.[index]:undefined

//   if (nextStep)
//   {
//     const previousStep = (index !== undefined && index > 0) ? state.plan?.[index - 1] : undefined;
//     const driver = new JsonDriver(getChatLLM());

//     switch (nextStep.agent) {
//       case "InternetSearchAgent": {
//         const { parsed } = await driver.generate(
//           z.object({
//             search_query: z.string()
//           }), [
//           BaseMessage.of({
//             role: `user`,
//             text: SEARCH_AGENT_PROMPT.render({task: nextStep.step}),
//           }),
//         ]);

//         console.log(parsed.search_query)

//         const toolOutput: SearxngToolOutput = await new SearxngTool().run({query: parsed.search_query})
//         nextStep.solution = JSON.stringify(toolOutput.results, null, 4)
//         return { update: { plan: state.plan }, next: "executor"};
//       }
//       case "ResearchAgent": {
//         const { parsed } = await driver.generate(
//           z.object({
//             result: z.string()
//           }), [
//           BaseMessage.of({
//             role: `user`,
//             text: RESEARCH_AGENT_PROMPT.render({task: nextStep.step, context: previousStep?.solution}),
//           }),
//         ]);
//         nextStep.solution = parsed.result
//         return { update: { plan: state.plan }, next: "executor"};
//       }
//       default:
//           break;
//       }
//   }

//   const lastStep = state.plan?.[state.plan?.length - 1];
//   return { update :{ output: lastStep?.solution}, next: Workflow.END};
// })

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
      plan: [],
      memory: memory.asReadOnly(),
    })
    .observe((emitter) => {
      emitter.on("start", ({ step, run }) => {
        reader.write(`-> ▶️ ${step}`, JSON.stringify(run.state).substring(0, 200).concat("..."));
      });
    });

  lastResult = result;
  reader.write("🤖 Answer", lastResult.output);

  const assistantMessage = BaseMessage.of({
    role: Role.ASSISTANT,
    text: lastResult.output,
    meta: { createdAt: new Date() },
  });

  await memory.add(assistantMessage);
}

import { UnconstrainedMemory } from "beeai-framework/memory/unconstrainedMemory";
import { createConsoleReader } from "./helpers/reader.js";
import { BeeCanvasAgent } from "./bee-canvas/agent.js";
import { getChatModel } from "./helpers/model.js";

const chatModel = getChatModel();

const workflow = new BeeCanvasAgent(chatModel).getWorkflow();
const memory = new UnconstrainedMemory();
const reader = createConsoleReader();

const artifact_title = `Email Draft`;
const artifact = `# Email Draft

Subject: Urgent Notice: Break Room Refrigerator

Dear Team,

I hope this message finds you well. I am writing to inform you of an unusual situation that has arisen in our break room.

Our refrigerator, which recently had a basic AI system installed for convenience, has exhibited unexpected behavior. It appears to have developed a form of sentience, engaging in spontaneous and unpredictable interactions.

While this may sound like a scene from a science fiction movie, the safety and well-being of our team is our top priority. Therefore, we kindly ask that you avoid any conversation or interaction with the refrigerator until further notice.

Our IT support team has been alerted and will be dispatching a specialist to assess and rectify the situation as soon as possible. We understand that this may cause some inconvenience, and we apologize for any disruption.

In the meantime, please use alternative cooling solutions available in the break room. Your understanding and cooperation in this matter are greatly appreciated.

Thank you for your attention to this matter. If you have any questions or concerns, feel free to reach out directly.

Best regards,
[Your Name]
[Your Position]`;
const prompt =
  "The issue was actually caused by a bacterial colony becoming self aware and interfacing with the main circuit board";
const offset = 199;
const length = 222;

// console.log(artifact.slice(offset, offset + length));

const { result } = await workflow
  .run({
    input: prompt,
    output: "",
    selectedTextOffset: offset,
    selectedTextLength: length,
    artifact: artifact,
    artifact_title: artifact_title,
    memory: memory.asReadOnly(),
  })
  .observe((emitter) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    emitter.on("start", ({ step, run }) => {
      reader.write(`-> ▶️  ${step}`, "");
    });
  });

reader.write("🤖 Artifact:", `\n${result.artifact || ""}`);
reader.write("🤖 Response:", result.output || "");

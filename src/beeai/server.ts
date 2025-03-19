#!/usr/bin/env -S BEE_FRAMEWORK_INSTRUMENTATION_ENABLED=true npx -y tsx@latest

import { AcpServer } from "@i-am-bee/acp-sdk/server/acp";

import { Version } from "beeai-framework";
import { runAgentProvider } from "@i-am-bee/beeai-sdk/providers/agent";
import { agent as beeCanvasAgent } from "./beeai_agent.js";

async function registerAgents(server: AcpServer) {
  server.agent(
    beeCanvasAgent.name,
    beeCanvasAgent.description,
    beeCanvasAgent.inputSchema,
    beeCanvasAgent.outputSchema,
    beeCanvasAgent.run,
    beeCanvasAgent.metadata,
  );
}

export async function createServer() {
  const server = new AcpServer({
    name: "bee-canvas",
    version: Version,
  });
  await registerAgents(server);
  return server;
}

const server = await createServer();
await runAgentProvider(server);

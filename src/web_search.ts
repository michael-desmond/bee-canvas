import "dotenv/config";
import { SearxngTool, SearxngToolOutput } from "src/tools/searxng.js";

const searxngTool = new SearxngTool({ maxResults: 10 });
const output: SearxngToolOutput = await searxngTool.run({ query: "longest living vertebrate" }, {});

console.log(JSON.stringify(output.results, null, 2));

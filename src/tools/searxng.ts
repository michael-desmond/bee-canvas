/**
 * Copyright 2025 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ToolEmitter, Tool, ToolInput, BaseToolRunOptions } from "bee-agent-framework/tools/base";
import { z } from "zod";
import { Emitter } from "bee-agent-framework/emitter/emitter";
import { createURLParams } from "bee-agent-framework/internals/fetcher";
import { RunContext } from "bee-agent-framework/context";
import {
  SearchToolOptions,
  SearchToolOutput,
  SearchToolResult,
  SearchToolRunOptions,
} from "bee-agent-framework/tools/search/base";
import { ValidationError } from "ajv";

export interface SearxngToolOptions extends SearchToolOptions {
  baseUrl?: string;
  maxResults: number;
}

type SearxngToolRunOptions = SearchToolRunOptions;

export interface SearxngToolResult extends SearchToolResult {}

export class SearxngToolOutput extends SearchToolOutput<SearxngToolResult> {
  constructor(public readonly results: SearxngToolResult[]) {
    super(results);
  }

  static {
    this.register();
  }

  createSnapshot() {
    return {
      results: this.results,
    };
  }

  loadSnapshot(snapshot: ReturnType<typeof this.createSnapshot>) {
    Object.assign(this, snapshot);
  }
}

export class SearxngTool extends Tool<
  SearxngToolOutput,
  SearxngToolOptions,
  SearxngToolRunOptions
> {
  name = "Web Search";
  description = `A web search tool`;

  public readonly emitter: ToolEmitter<ToolInput<this>, SearxngToolOutput> = Emitter.root.child({
    namespace: ["tool", "web", "search"],
    creator: this,
  });

  inputSchema() {
    return z.object({
      query: z.string().min(1).describe(`Web search query.`),
    });
  }

  protected baseUrl: string;

  public constructor(options: SearxngToolOptions = { maxResults: 10 }) {
    super(options);
    this.baseUrl = options.baseUrl || "http://127.0.0.1:8888/search";

    if (options.maxResults < 1 || options.maxResults > 100) {
      throw new ValidationError([
        {
          message: "Property 'maxResults' must be between 1 and 100",
          propertyName: "options.maxResults",
        },
      ]);
    }
  }

  protected _prepareParams(input: ToolInput<typeof this>) {
    return createURLParams({
      q: input.query,
      format: "json",
    });
  }

  protected async _run(
    input: ToolInput<this>,
    _options: Partial<BaseToolRunOptions>,
    run: RunContext<this>,
  ) {
    const params = this._prepareParams(input);
    const url = `${this.baseUrl}?${decodeURIComponent(params.toString())}`;
    console.log(url);
    const response = await fetch(url, {
      signal: run.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();

    return new SearxngToolOutput(
      data.results.map((result: { url: string; title: string; content: string }) => ({
        url: result.url || "",
        title: result.title || "",
        description: result.content || "",
      })),
    );
  }

  createSnapshot() {
    return {
      ...super.createSnapshot(),
      baseUrl: this.baseUrl,
    };
  }

  loadSnapshot({ baseUrl, ...snapshot }: ReturnType<typeof this.createSnapshot>) {
    super.loadSnapshot(snapshot);
    Object.assign(this, {
      baseUrl,
    });
  }
}

import {describe, expect, jest, test} from '@jest/globals';
import { ToolCallingLLM } from '../src';
import { ChatOllama } from '@langchain/ollama';
import {AIMessage, BaseMessageChunk} from "@langchain/core/messages";
import { z } from "zod";
import { BindToolsInput } from "@langchain/core/dist/language_models/chat_models";

describe('Ollama With Tools', () => {
  let llm: ChatOllama;
  let toolsLLM: ToolCallingLLM<ChatOllama>;
  const modelName: string = "llama3";
  const weatherTool: BindToolsInput =  {
    name: "weather",
    description:
        "Call to get the current weather for a location.",
    schema: z.object({
      query: z.string().describe("The query to use in your search."),
    }),
  };
  beforeEach(() => {
    llm = new ChatOllama({model: modelName, format: "json"});
    toolsLLM = new ToolCallingLLM(llm);
  });
  it("Verify Base Model works", async () => {
    let response: AIMessage = await llm.invoke("What is 2 + 2?");
    expect(response.content.toString().includes('4')).toBeTruthy();
  }, 10000);
  it("Verify Base Model doesn't support tools", async () => {
    const llmWithTools = llm.bindTools!([weatherTool]);
    await expect(
        llmWithTools.invoke("What is weather in San Francisco?")
    ).rejects.toThrow("llama3 does not support tools");
  });
  it('Default Response', async () => {
    let response: AIMessage = await toolsLLM.invoke("What is 2 + 2?");
    expect(response.tool_calls?.length).toBe(0);
    expect(response.content.toString().includes('4')).toBeTruthy();
  }, 10000);
  it('With Structured Output', async () =>{
    const joke = z.object({
      setup: z.string().describe("The setup of the joke"),
      punchline: z.string().describe("The punchline to the joke"),
      rating: z.number().optional().describe("How funny the joke is, from 1 to 10"),
    });
    const llmWithStructuredOutput = toolsLLM.withStructuredOutput(joke);
    const response = await llmWithStructuredOutput.invoke("Tell me a joke about cats");
    expect(response.setup).toBeTruthy();
    expect(response.punchline).toBeTruthy();
    expect(response.rating).toBeTruthy();
  }, 10000);
  it('With Tool Definition', async () => {
    const llmWithTools = toolsLLM.bindTools!([weatherTool]);
    const response: AIMessage = await llmWithTools.invoke("What is weather in San Francisco?");
    expect(response.tool_calls).toBeDefined();
    expect(response.tool_calls!.length).toBe(1);
    expect(response.tool_calls![0].name).toBe("weather");
  }, 10000);
  it('does stream', async () => {
    const llmWithTools = toolsLLM.bindTools!([weatherTool]);
    let generation: BaseMessageChunk | undefined = undefined;
    for await (const chunk of await llmWithTools.stream("What is the weather in San Franscisco?")){
      if (generation) {
        generation = generation.concat(chunk);
      } else {
        generation = chunk;
      }
    }
    expect(generation).not.toBeUndefined();
    const response: AIMessage = <AIMessage>generation;
    expect(response.tool_calls).toBeDefined();
    expect(response.tool_calls!.length).toBe(1);
    expect(response.tool_calls![0].name).toBe("weather");
  }, 10000);
});

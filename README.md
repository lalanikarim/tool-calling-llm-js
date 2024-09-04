Tool Calling LLM
================

Tool Calling LLM brings the functionality of [tool-calling-llm](https://pypi.org/project/tool-calling-llm/) package from python to JavaScript/TypeScript and lets you add tool calling capabilities effortlessly to [LangChain](https://langchain.com)'s Chat Models that don't yet support tool/function calling natively. 
Simply create a new chat model class with ToolCallingLLM and your favorite chat model to get started.

With ToolCallingLLM you also get access to the following functions:
1. `.bind_tools()` allows you to bind tool definitions with a llm.
2. `.withStructuredOutput()` allows you to return structured data from your model. This is now being provided by LangChain's `BaseChatModel` class.

At this time, ToolCallingLLM has been tested to work with [ChatOllama](https://js.langchain.com/v0.2/docs/integrations/chat/ollama/) and [ChatCloudflareWorkersAI](https://js.langchain.com/v0.2/docs/integrations/chat/cloudflare_workersai/).

Installation
------------

```bash
npm install tool-calling-llm
```

Usage
-----

Creating a Tool Calling LLM is as simple as creating a new sub class of the original ChatModel you wish to add tool calling features to.

Below sample code demonstrates how you might enhance `ChatOllama` chat model from `langchain-ollama` package with tool calling capabilities.

```typescript
import { ToolCallingLLM } from "tool-calling-llm";
import { ChatOllama } from '@langchain/ollama';
import { DuckDuckGoSearch } from "@langchain/community/tools/duckduckgo_search";

const tool = new DuckDuckGoSearch({ maxResults: 1 });
const llm = new ChatOllama({ model: "llama3.1", format: "json"});
const toolCallingLLM = new ToolCallingLLM(llm);
const llmWithTools = toolCallingLLM.bindTools([tool]);

await llmWithTools.invoke("Who won the silver medal in shooting in the Paris Olympics in 2024?");
```

This yields output as follows:
```
AIMessage {
  "content": "",
  "additional_kwargs": {},
  "response_metadata": {},
  "tool_calls": [
    {
      "name": "duckduckgo-search",
      "args": {
        "input": "What is the result of the 2024 Paris Olympics shooting events?"
      },
      "id": "call_7669c140b9f041178dbf65f8c80acd88"
    }
  ],
  "invalid_tool_calls": []
}
```
import {AIMessage, BaseMessage, BaseMessageChunk} from '@langchain/core/messages';
import {SystemMessagePromptTemplate} from '@langchain/core/prompts';
import {Runnable} from '@langchain/core/runnables';
import {BaseChatModel } from '@langchain/core/language_models/chat_models';
import {DEFAULT_RESPONSE_FUNCTION, DEFAULT_SYSTEM_TEMPLATE} from './constants';
import * as uuid from 'uuid';
import {BaseLanguageModelInput } from "@langchain/core/dist/language_models/base";
import {
    BaseChatModelCallOptions,
    BindToolsInput
} from "@langchain/core/dist/language_models/chat_models";
import {convertToOpenAITool} from '@langchain/core/utils/function_calling';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { ChatResult } from '@langchain/core/outputs';

export function parseJsonGarbage(s: string): any {
    // Find the first occurrence of a JSON opening brace or bracket
    let startIndex = s.indexOf('{');
    let jsonString = '';

    if (startIndex === -1) {
        // If no '{' is found, try for '['
        const altStartIndex = s.indexOf('[');
        if (altStartIndex !== -1) {
            startIndex = altStartIndex;
        } else {
            throw new Error("No JSON object or array found in the input string.");
        }
    }

    jsonString = s.substring(startIndex);

    try {
        return JSON.parse(jsonString);
    } catch (e) {
        // Handle JSON parsing errors
        if (typeof e === 'string' && e.includes('Unexpected')) {
            throw new Error("Invalid JSON in the input string.");
        } else if (e instanceof SyntaxError) {
            throw new Error("Invalid syntax in the input string.");
        }
        throw e; // Re-throw other errors
    }
}

export function parseResponse(message: BaseMessage): string {
    if (message instanceof AIMessage) {
        const { tool_calls } = message;
        if (tool_calls && tool_calls.length > 0) {
            const toolCall = tool_calls[tool_calls.length - 1];
            const args = toolCall.args;
            return JSON.stringify(args);
        } else {
            throw new Error(`"tool_calls" missing from AIMessage: ${message}`);
        }
    }
    throw new Error(`"message" is not an instance of "AIMessage": ${message}`);
}

export class ToolCallingLLM<O extends BaseChatModel, CallOptions extends BaseChatModelCallOptions = BaseChatModelCallOptions, OutputMessageType extends BaseMessageChunk = BaseMessageChunk> extends BaseChatModel<CallOptions, OutputMessageType> {
    toolSystemPromptTemplate: string = DEFAULT_SYSTEM_TEMPLATE;
    //overrideBindTools: boolean = true;
    tools?: BindToolsInput[];
    model: BaseChatModel;

    constructor(model: O) {
        super(model);
        this.model = model;
    }


    bindTools?(tools: BindToolsInput[], kwargs?: Partial<CallOptions>): Runnable<BaseLanguageModelInput, OutputMessageType, CallOptions> {
        this.tools = tools;
        return super.bind(kwargs!);
    }

    protected _generateSystemMessageAndToolDefs(): [Promise<BaseMessage>, any] {
        let functions = this.tools || [];
        functions.push(DEFAULT_RESPONSE_FUNCTION);
        functions = functions.map(convertToOpenAITool);
        const system_message = SystemMessagePromptTemplate.fromTemplate(this.toolSystemPromptTemplate).format({
            tools: JSON.stringify(functions, null, 2)
        });
        return [system_message, functions];
    }

    protected _processResponse(response_message: BaseMessage, functions: any[]): AIMessage {
        const chat_generation_content = response_message.content;
        let parsed_chat_result;
        try {
            if (typeof chat_generation_content === "string") {
                parsed_chat_result = JSON.parse(chat_generation_content);
            }
        } catch (e) {
            try {
                parsed_chat_result = parseJsonGarbage(chat_generation_content.toString());
            } catch (e) {
                throw new Error(`'${this.model.name}' did not respond with valid JSON.\nPlease try again.\nResponse: ${chat_generation_content}`);
            }
        }
        const called_tool_name = parsed_chat_result["tool"] || null;
        const called_tool = functions.find(fn => fn["function"]["name"] === called_tool_name);
        if (!called_tool || called_tool["function"]["name"] === DEFAULT_RESPONSE_FUNCTION["function"]["name"]) {
            let response = "";
            if ('tool_input' in parsed_chat_result && 'response' in parsed_chat_result['tool_input']){
                response = parsed_chat_result['tool_input']['response'];
            } else if ('response' in parsed_chat_result) {
                response = parsed_chat_result['response'];
            } else {
                throw new Error(`Failed to parse a response from ${this.model.name} output: ${chat_generation_content}`);
            }
            return new AIMessage({content: response});
        }
        const tool_input = parsed_chat_result["tool_input"] || {};
        return new AIMessage({
            content: "",
            tool_calls: [{
                name: called_tool_name,
                args: tool_input,
                id: `call_${String(uuid.v4()).replace(/-/g, '')}`
            }]
        });
    }

    async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"], runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {
        const [system_message_promise, tools] = this._generateSystemMessageAndToolDefs();
        const system_message = await system_message_promise;
        const response_message = await this.model._generate(
            [system_message, ...messages], options,runManager
        );
        const response = this._processResponse(response_message.generations[0].message, tools);
        return {
            generations:[{
                message: response,
                text: ""
            }]
        };
    }

    _llmType(): string {
        return "Tool Calling LLM";
    }

    _modelType(): string {
        return "Tool Calling Model";
    }
}

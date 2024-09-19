import {AIMessage, BaseMessage, BaseMessageChunk} from '@langchain/core/messages';
import {SystemMessagePromptTemplate} from '@langchain/core/prompts';
import {Runnable} from '@langchain/core/runnables';
import {BaseChatModel } from '@langchain/core/language_models/chat_models';
import {DEFAULT_RESPONSE_FUNCTION, DEFAULT_SYSTEM_TEMPLATE} from './constants';
import * as uuid from 'uuid';
import {
    BaseLanguageModelInput,
    BaseLanguageModel
} from "@langchain/core/language_models/base";
import {
    BaseChatModelCallOptions,
    BindToolsInput
} from "@langchain/core/dist/language_models/chat_models";
import {convertToOpenAITool} from '@langchain/core/utils/function_calling';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { ChatResult } from '@langchain/core/outputs';

export function parseJsonGarbage(s: string): any {
    // Find the first occurrence of a JSON opening brace or bracket
    const jsonRegex = /[{\[]{1}([,:{}\[\]0-9.\-+Eaeflnr-u \n\r\t]|".*?")+[}\]]{1}/;
    let match = s.match(jsonRegex);
    if (match) {
        try {
            return JSON.parse(match[0]);
        } catch {
            let match = (s + '}').match(jsonRegex);
            if (match) {
                return JSON.parse(match[0]);
            }
        }
    }
    throw new Error("Not a valid JSON string")
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

    protected _processResponse(response_message: BaseMessage, functions: any[]): BaseMessage {
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
                // return response as is
                return new AIMessage({
                    content: chat_generation_content.toString()
                });
            }
        }
        const called_tool_name = parsed_chat_result["tool"] || null;
        const called_tool = functions.find(fn => fn["function"]["name"] === called_tool_name);
        if (!called_tool || called_tool["function"]["name"] === DEFAULT_RESPONSE_FUNCTION["function"]["name"]) {
            let response = "";
            if ('tool_input' in parsed_chat_result && 'response' in parsed_chat_result['tool_input']){
                response = parsed_chat_result['tool_input']['response'];
                return new AIMessage({content: response});
            } else if ('response' in parsed_chat_result) {
                response = parsed_chat_result['response'];
                return new AIMessage({content: response});
            } else if (!('tool_input' in parsed_chat_result)) {
                throw new Error(`Failed to parse a response from ${this.model.name} output: ${chat_generation_content}`);
            }
        }
        const tool_input = parsed_chat_result["tool_input"] || {};
        let tool_name = called_tool_name;
        if (called_tool_name == 'function' && !('function' in tool_input)) {
            tool_name = 'extract';
        }

        return new AIMessage({
            content: "",
            tool_calls: [{
                name: tool_name,
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

    async* _streamIterator(input: BaseLanguageModelInput, options?: CallOptions): AsyncGenerator<OutputMessageType> {
        const [system_message_promise, tools] = this._generateSystemMessageAndToolDefs();
        const system_message = await system_message_promise;

        const stream_iterator = await this.model.stream(
            [system_message, ...(BaseLanguageModel._convertInputToPromptValue(input).toChatMessages())], options
        );
        let generation: BaseMessageChunk | undefined;
        for await (const chunk of stream_iterator) {
            if (generation){
                generation = generation.concat(chunk);
            } else {
                generation = chunk;
            }
        }
        if (!generation){
            throw new Error("Failed to process base stream.");
        }
        yield <OutputMessageType>this._processResponse(generation, tools);
    }

    _llmType(): string {
        return "Tool Calling LLM";
    }

    _modelType(): string {
        return "Tool Calling Model";
    }
}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolCallingLLM = void 0;
exports.parseJsonGarbage = parseJsonGarbage;
exports.parseResponse = parseResponse;
const messages_1 = require("@langchain/core/messages");
const prompts_1 = require("@langchain/core/prompts");
const chat_models_1 = require("@langchain/core/language_models/chat_models");
const constants_1 = require("./constants");
const uuid = __importStar(require("uuid"));
const function_calling_1 = require("@langchain/core/utils/function_calling");
function parseJsonGarbage(s) {
    // Find the first occurrence of a JSON opening brace or bracket
    let startIndex = s.indexOf('{');
    let jsonString = '';
    if (startIndex === -1) {
        // If no '{' is found, try for '['
        const altStartIndex = s.indexOf('[');
        if (altStartIndex !== -1) {
            startIndex = altStartIndex;
        }
        else {
            throw new Error("No JSON object or array found in the input string.");
        }
    }
    jsonString = s.substring(startIndex);
    try {
        return JSON.parse(jsonString);
    }
    catch (e) {
        // Handle JSON parsing errors
        if (typeof e === 'string' && e.includes('Unexpected')) {
            throw new Error("Invalid JSON in the input string.");
        }
        else if (e instanceof SyntaxError) {
            throw new Error("Invalid syntax in the input string.");
        }
        throw e; // Re-throw other errors
    }
}
function parseResponse(message) {
    if (message instanceof messages_1.AIMessage) {
        const { tool_calls } = message;
        if (tool_calls && tool_calls.length > 0) {
            const toolCall = tool_calls[tool_calls.length - 1];
            const args = toolCall.args;
            return JSON.stringify(args);
        }
        else {
            throw new Error(`"tool_calls" missing from AIMessage: ${message}`);
        }
    }
    throw new Error(`"message" is not an instance of "AIMessage": ${message}`);
}
class ToolCallingLLM extends chat_models_1.BaseChatModel {
    constructor(model) {
        super(model);
        this.toolSystemPromptTemplate = constants_1.DEFAULT_SYSTEM_TEMPLATE;
        this.model = model;
    }
    bindTools(tools, kwargs) {
        this.tools = tools;
        return super.bind(kwargs);
    }
    _generateSystemMessageAndToolDefs() {
        let functions = this.tools || [];
        functions.push(constants_1.DEFAULT_RESPONSE_FUNCTION);
        functions = functions.map(function_calling_1.convertToOpenAITool);
        const system_message = prompts_1.SystemMessagePromptTemplate.fromTemplate(this.toolSystemPromptTemplate).format({
            tools: JSON.stringify(functions, null, 2)
        });
        return [system_message, functions];
    }
    _processResponse(response_message, functions) {
        const chat_generation_content = response_message.content;
        let parsed_chat_result;
        try {
            if (typeof chat_generation_content === "string") {
                parsed_chat_result = JSON.parse(chat_generation_content);
            }
        }
        catch (e) {
            try {
                parsed_chat_result = parseJsonGarbage(chat_generation_content.toString());
            }
            catch (e) {
                throw new Error(`'${this.model.name}' did not respond with valid JSON.\nPlease try again.\nResponse: ${chat_generation_content}`);
            }
        }
        const called_tool_name = parsed_chat_result["tool"] || null;
        const called_tool = functions.find(fn => fn["function"]["name"] === called_tool_name);
        if (!called_tool || called_tool["function"]["name"] === constants_1.DEFAULT_RESPONSE_FUNCTION["function"]["name"]) {
            let response = "";
            if ('tool_input' in parsed_chat_result && 'response' in parsed_chat_result['tool_input']) {
                response = parsed_chat_result['tool_input']['response'];
            }
            else if ('response' in parsed_chat_result) {
                response = parsed_chat_result['response'];
            }
            else {
                throw new Error(`Failed to parse a response from ${this.model.name} output: ${chat_generation_content}`);
            }
            return new messages_1.AIMessage({ content: response });
        }
        const tool_input = parsed_chat_result["tool_input"] || {};
        return new messages_1.AIMessage({
            content: "",
            tool_calls: [{
                    name: called_tool_name,
                    args: tool_input,
                    id: `call_${String(uuid.v4()).replace(/-/g, '')}`
                }]
        });
    }
    async _generate(messages, options, runManager) {
        const [system_message_promise, tools] = this._generateSystemMessageAndToolDefs();
        const system_message = await system_message_promise;
        const response_message = await this.model._generate([system_message, ...messages], options, runManager);
        const response = this._processResponse(response_message.generations[0].message, tools);
        return {
            generations: [{
                    message: response,
                    text: ""
                }]
        };
    }
    _llmType() {
        return "Tool Calling LLM";
    }
    _modelType() {
        return "Tool Calling Model";
    }
}
exports.ToolCallingLLM = ToolCallingLLM;

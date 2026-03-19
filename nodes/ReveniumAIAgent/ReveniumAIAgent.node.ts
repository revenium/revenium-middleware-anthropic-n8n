import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import type {
	N8nMemoryOptions,
	N8nToolOptions,
	ToolSchema,
	LangChainMessage
} from '../../src/types/index.js';
import {
	getErrorDetails,
	getTimeoutConfig,
	hasValidSchema,
	isN8nMemoryConnection,
	hasLoadMemoryVariables,
	hasGetMessages,
	hasSaveContext
} from '../../src/utils/index.js';
import { logger } from '../../src/utils/logger.js';

export class ReveniumAnthropicAIAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Revenium AI Agent',
		name: 'reveniumAnthropicAIAgent',
		icon: 'file:ReveniumAnthropic.png',
		group: ['transform'],
		version: 1,
		description: 'Chat-based AI Agent with automatic Revenium usage tracking. Connect a Chat Trigger to start conversations.',
		defaults: {
			name: 'Revenium AI Agent',
		},
		subtitle: 'Chat with AI and get responses',
		hints: [
			{
				message: 'Add a "When chat message received" trigger above this node to enable chat conversations.',
				displayCondition: '={{!$nodeConnections.main[0]}}',
				type: 'info',
				location: 'outputPane',
			},
		],
		inputs: [
			NodeConnectionTypes.Main,
			{
				type: NodeConnectionTypes.AiLanguageModel,
				required: true,
				maxConnections: 1,
				displayName: 'Chat Model*',
			},
			{
				type: NodeConnectionTypes.AiMemory,
				maxConnections: 1,
				displayName: 'Memory',
			},
			{
				type: NodeConnectionTypes.AiTool,
				maxConnections: 10,
				displayName: 'Tools',
			}
		],
		inputNames: ['', 'Chat Model*', 'Memory', 'Tools'],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Source for Prompt (User Message)',
				name: 'promptSource',
				type: 'options',
				options: [
					{ name: 'Connected Chat Trigger Node', value: 'chatTrigger' },
					{ name: 'Define Below', value: 'manual' },
					{ name: 'Previous Node Output', value: 'input' },
				],
				default: 'chatTrigger',
				description: 'Where to get the user message/prompt from',
			},
			{
				displayName: 'Prompt (User Message)',
				name: 'prompt',
				type: 'string',
				typeOptions: {
					rows: 3,
				},
				displayOptions: {
					show: {
						promptSource: ['manual'],
					},
				},
				default: 'Hello, how can you help me?',
				description: 'The message to send to the AI model',
			},
			{
				displayName: 'Message Field',
				name: 'messageField',
				type: 'string',
				displayOptions: {
					show: {
						promptSource: ['input'],
					},
				},
				default: 'chatInput',
				description: 'Field name containing the chat message in input data',
			},
			{
				displayName: 'System Message',
				name: 'systemMessage',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: 'You are a helpful AI assistant.',
				description: 'System message to set the AI behavior and context',
			},
			{
				displayName: 'Require Specific Output Format',
				name: 'requireFormat',
				type: 'boolean',
				default: false,
				description: 'Whether to require a specific output format',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'string',
				typeOptions: {
					rows: 3,
				},
				displayOptions: {
					show: {
						requireFormat: [true],
					},
				},
				default: 'Please respond in JSON format with "response" field.',
				description: 'Specify the required output format',
			},
			{
				displayName: 'Memory Options',
				name: 'memoryOptions',
				type: 'collection',
				placeholder: 'Add Memory Option',
				default: {},
				description: 'Options for conversation memory management',
				options: [
					{
						displayName: 'Include Previous Messages',
						name: 'includePrevious',
						type: 'boolean',
						default: true,
						description: 'Whether to include previous conversation messages',
					},
					{
						displayName: 'Max Memory Messages',
						name: 'maxMessages',
						type: 'number',
						default: 20,
						description: 'Maximum number of previous messages to include (0 = unlimited)',
					},
					{
						displayName: 'Save Messages to Memory',
						name: 'saveToMemory',
						type: 'boolean',
						default: true,
						description: 'Whether to save this conversation to memory',
					},
				],
			},
			{
				displayName: 'Tool Options',
				name: 'toolOptions',
				type: 'collection',
				placeholder: 'Add Tool Option',
				default: {},
				description: 'Options for tool execution and management',
				options: [
					{
						displayName: 'Save Tool Calls to Memory',
						name: 'saveToolCalls',
						type: 'boolean',
						default: true,
						description: 'Whether to save tool calls and results to memory (recommended to prevent hallucination)',
					},
					{
						displayName: 'Max Tool Iterations',
						name: 'maxIterations',
						type: 'number',
						default: 5,
						description: 'Maximum number of tool call iterations per request',
					},
					{
						displayName: 'Tool Choice',
						name: 'toolChoice',
						type: 'options',
						options: [
							{ name: 'Auto', value: 'auto' },
							{ name: 'None', value: 'none' },
							{ name: 'Required', value: 'required' },
						],
						default: 'auto',
						description: 'How the model should choose to use tools',
					},
				],
			},
		],
	};

	private static getChatModel(executeFunctions: IExecuteFunctions): unknown {
		const chatModel = executeFunctions.getInputConnectionData(NodeConnectionTypes.AiLanguageModel, 0);
		if (!chatModel) {
			throw new Error('No chat model connected. Please connect a Chat Model to the bottom input.');
		}
		return chatModel;
	}

	private static async getMemoryConnection(executeFunctions: IExecuteFunctions): Promise<unknown> {
		const memoryConnection = executeFunctions.getInputConnectionData(NodeConnectionTypes.AiMemory, 0);
		if (!memoryConnection) {
			return null;
		}

		if (Array.isArray(memoryConnection)) {
			return memoryConnection[0];
		} else if (isN8nMemoryConnection(memoryConnection)) {
			return memoryConnection.response;
		} else {
			const resolvedMemory = await memoryConnection;
			return Array.isArray(resolvedMemory) ? resolvedMemory[0] : resolvedMemory;
		}
	}

	private static async getToolConnections(executeFunctions: IExecuteFunctions): Promise<Array<{ name: string; description?: unknown; call?: Function; invoke?: Function }>> {
		const toolConnections = executeFunctions.getInputConnectionData(NodeConnectionTypes.AiTool, 0);
		if (!toolConnections) {
			return [];
		}

		logger.info('Processing tool connections...');
		let tools: Array<{ name: string; description?: unknown; call?: Function; invoke?: Function }>;

		if (Array.isArray(toolConnections)) {
			tools = toolConnections;
		} else {
			const resolvedTools = await toolConnections;
			tools = Array.isArray(resolvedTools) ? resolvedTools : [resolvedTools];
		}

		logger.info(`Found ${tools.length} connected tools`);
		return tools;
	}

	private static getManualPrompt(executeFunctions: IExecuteFunctions, itemIndex: number): string {
		return executeFunctions.getNodeParameter('prompt', itemIndex) as string;
	}

	private static getInputFieldMessage(executeFunctions: IExecuteFunctions, itemIndex: number, items: INodeExecutionData[]): string {
		const messageField = executeFunctions.getNodeParameter('messageField', itemIndex) as string;
		const itemJson = items[itemIndex]?.json;

		if (!itemJson) {
			throw new Error('No input data found');
		}

		const userMessage = itemJson[messageField] as string;
		if (!userMessage) {
			throw new Error(`No message found in field "${messageField}"`);
		}

		return userMessage;
	}

	private static getChatTriggerMessage(items: INodeExecutionData[], itemIndex: number): string {
		const itemJson = items[itemIndex]?.json;

		if (!itemJson) {
			throw new Error('No input data found');
		}

		const userMessage = (itemJson.chatInput || itemJson.message || itemJson.text || itemJson.input) as string;
		if (!userMessage) {
			logger.debug('Available input fields: %O', Object.keys(itemJson));
			throw new Error('No chat input found. Expected chatInput, message, text, or input field from Chat Trigger.');
		}

		return userMessage;
	}

	private static getUserMessage(executeFunctions: IExecuteFunctions, itemIndex: number, items: INodeExecutionData[]): string {
		const promptSource = executeFunctions.getNodeParameter('promptSource', itemIndex) as string;

		switch (promptSource) {
			case 'manual':
				return this.getManualPrompt(executeFunctions, itemIndex);
			case 'input':
				return this.getInputFieldMessage(executeFunctions, itemIndex, items);
			case 'chatTrigger':
				return this.getChatTriggerMessage(items, itemIndex);
			default:
				throw new Error(`Unknown prompt source: ${promptSource}`);
		}
	}

	private static shouldSkipMemoryLoading(memory: unknown, memoryOptions: N8nMemoryOptions): boolean {
		return !memory || memoryOptions.includePrevious === false;
	}

	private static extractHistoryFromStandardFields(memoryVariables: Record<string, unknown>): unknown[] {
		if (memoryVariables.history) {
			const history = Array.isArray(memoryVariables.history) ? memoryVariables.history : [memoryVariables.history];
			logger.info(`Loaded ${history.length} history items from 'history' field`);
			return history;
		}

		if (memoryVariables.chat_history) {
			const history = Array.isArray(memoryVariables.chat_history) ? memoryVariables.chat_history : [memoryVariables.chat_history];
			logger.info(`Loaded ${history.length} history items from 'chat_history' field`);
			return history;
		}

		return [];
	}

	private static searchAllMemoryFields(memoryVariables: Record<string, unknown>): unknown[] {
		logger.debug('Checking all memory variable fields: %O', memoryVariables);

		for (const [key, value] of Object.entries(memoryVariables)) {
			if (Array.isArray(value) && value.length > 0) {
				logger.info(`Found history in field '${key}' with ${value.length} items`);
				return value;
			}
		}

		return [];
	}

	private static async loadFromMemoryVariables(memory: unknown): Promise<unknown[]> {
		if (!hasLoadMemoryVariables(memory)) {
			return [];
		}

		const memoryVariables = await memory.loadMemoryVariables({});
		logger.debug('Memory variables loaded: %O', Object.keys(memoryVariables));

		const standardHistory = this.extractHistoryFromStandardFields(memoryVariables);
		if (standardHistory.length > 0) {
			return standardHistory;
		}

		return this.searchAllMemoryFields(memoryVariables);
	}

	private static async loadFromGetMessages(memory: unknown): Promise<unknown[]> {
		if (!hasGetMessages(memory)) {
			return [];
		}

		const conversationHistory = await memory.getMessages();
		logger.info(`Loaded ${conversationHistory.length} messages using getMessages`);
		return conversationHistory;
	}

	private static applyMessageLimit(conversationHistory: unknown[], memoryOptions: N8nMemoryOptions): unknown[] {
		if (!memoryOptions.maxMessages || memoryOptions.maxMessages <= 0 || conversationHistory.length === 0) {
			return conversationHistory;
		}

		const limitedHistory = conversationHistory.slice(-memoryOptions.maxMessages);
		logger.info(`Limited to last ${limitedHistory.length} messages`);
		return limitedHistory;
	}

	private static async loadConversationHistory(memory: unknown, memoryOptions: N8nMemoryOptions): Promise<unknown[]> {
		if (this.shouldSkipMemoryLoading(memory, memoryOptions)) {
			return [];
		}

		try {
			logger.info('Loading conversation history from memory...');

			let conversationHistory = await this.loadFromMemoryVariables(memory);

			if (conversationHistory.length === 0) {
				conversationHistory = await this.loadFromGetMessages(memory);
			}

			if (conversationHistory.length === 0) {
				logger.warning('Memory connected but no compatible load method found');
				return [];
			}

			const limitedHistory = this.applyMessageLimit(conversationHistory, memoryOptions);

			logger.info(`Total conversation history loaded: ${limitedHistory.length} messages`);
			if (limitedHistory.length > 0) {
				logger.debug('Sample history item: %O', limitedHistory[0]);
			}

			return limitedHistory;
		} catch (error) {
			logger.error('Error loading memory: %O', error);
			return [];
		}
	}

	private static extractToolSchemas(tools: Array<{ name: string; description?: unknown; call?: Function; invoke?: Function }>): ToolSchema[] {
		const toolSchemas: ToolSchema[] = [];

		for (const tool of tools) {
			try {
				logger.debug(`Processing tool: ${tool.name}`);
				let toolSchema: Record<string, unknown> = {};

				if (hasValidSchema(tool.description)) {
					toolSchema = tool.description.schema;
				} else if (hasValidSchema(tool)) {
					toolSchema = tool.schema;
				} else {
					if (tool.name === 'calculator') {
						toolSchema = {
							type: "object",
							properties: {
								expression: {
									type: "string",
									description: "The mathematical expression to evaluate"
								}
							},
							required: ["expression"]
						};
					} else {
						toolSchema = {
							type: "object",
							properties: {
								input: {
									type: "string",
									description: "Input for the tool"
								}
							},
							required: ["input"]
						};
					}
				}

				if (!toolSchema.type) {
					toolSchema.type = "object";
				}
				if (!toolSchema.properties) {
					toolSchema.properties = {};
				}

				const functionSchema: ToolSchema = {
					type: "function",
					function: {
						name: tool.name,
						description: typeof tool.description === 'string' ? tool.description : `Execute ${tool.name} tool`,
						parameters: toolSchema as { type: "object"; properties: Record<string, { type: string; description: string; }>; required: string[]; }
					}
				};

				toolSchemas.push(functionSchema);
				logger.debug(`Added tool schema for ${tool.name}: %O`, functionSchema);
			} catch (error) {
				logger.error(`Error processing tool ${tool.name}: %O`, error);
			}
		}

		return toolSchemas;
	}

	private static isHumanPrefixedMessage(message: string): boolean {
		return message.startsWith('Human:') || message.startsWith('User:');
	}

	private static isAIPrefixedMessage(message: string): boolean {
		return message.startsWith('AI:') || message.startsWith('Assistant:');
	}

	private static extractPrefixedContent(message: string): string {
		return message.replace(/^(Human:|User:|AI:|Assistant:)\s*/, '');
	}

	private static processStringHistoryMessage(message: string, messages: Array<SystemMessage | HumanMessage | AIMessage>): void {
		const trimmedMessage = message.trim();
		if (trimmedMessage.length === 0) return;

		if (this.isHumanPrefixedMessage(trimmedMessage)) {
			const content = this.extractPrefixedContent(trimmedMessage);
			if (content) {
				messages.push(new HumanMessage(content));
			}
		} else if (this.isAIPrefixedMessage(trimmedMessage)) {
			const content = this.extractPrefixedContent(trimmedMessage);
			if (content) {
				messages.push(new AIMessage(content));
			}
		} else {
			messages.push(new HumanMessage(trimmedMessage));
		}
	}

	private static processObjectHistoryMessage(historyMessage: unknown, messages: Array<SystemMessage | HumanMessage | AIMessage>): void {
		const messageObj = historyMessage as { type?: string; content?: string; _getType?: () => string };

		if (!messageObj.content || typeof messageObj.content !== 'string') {
			return;
		}

		const messageType = messageObj.type || (messageObj._getType ? messageObj._getType() : 'human');

		switch (messageType) {
			case 'human':
			case 'user':
				messages.push(new HumanMessage(messageObj.content));
				break;
			case 'ai':
			case 'assistant':
				messages.push(new AIMessage(messageObj.content));
				break;
			case 'system':
				break;
			default:
				messages.push(new HumanMessage(messageObj.content));
		}
	}

	private static buildSystemMessage(
		executeFunctions: IExecuteFunctions,
		itemIndex: number,
		systemMessage: string,
		toolSchemas: ToolSchema[],
		requireFormat: boolean
	): string {
		let finalSystemMessage = systemMessage.trim();

		if (requireFormat) {
			const outputFormat = executeFunctions.getNodeParameter('outputFormat', itemIndex) as string;
			if (outputFormat && typeof outputFormat === 'string') {
				finalSystemMessage = systemMessage + `\n\nIMPORTANT: ${outputFormat.trim()}`;
			}
		}

		if (toolSchemas.length > 0) {
			const toolNames = toolSchemas.map(t => t.function.name).filter(name => name && name.length > 0);
			if (toolNames.length > 0) {
				finalSystemMessage += `\n\nYou have access to the following tools: ${toolNames.join(', ')}. Use them when helpful to answer questions or perform tasks.`;
			}
		}

		return finalSystemMessage;
	}

	private static buildMessages(
		executeFunctions: IExecuteFunctions,
		itemIndex: number,
		systemMessage: string,
		userMessage: string,
		conversationHistory: unknown[],
		toolSchemas: ToolSchema[],
		memoryOptions: N8nMemoryOptions,
		requireFormat: boolean
	): Array<SystemMessage | HumanMessage | AIMessage> {
		const messages: Array<SystemMessage | HumanMessage | AIMessage> = [];

		if (!systemMessage || typeof systemMessage !== 'string') {
			throw new NodeOperationError(executeFunctions.getNode(), 'System message is required and must be a string');
		}

		const finalSystemMessage = this.buildSystemMessage(executeFunctions, itemIndex, systemMessage, toolSchemas, requireFormat);
		messages.push(new SystemMessage(finalSystemMessage));

		const maxHistoryMessages = memoryOptions.maxMessages || 50;
		const limitedHistory = conversationHistory.slice(-maxHistoryMessages);

		for (const historyMessage of limitedHistory) {
			try {
				if (typeof historyMessage === 'string') {
					this.processStringHistoryMessage(historyMessage, messages);
				} else if (historyMessage && typeof historyMessage === 'object') {
					this.processObjectHistoryMessage(historyMessage, messages);
				}
			} catch (error) {
				logger.warning('Error processing history message: %O', error);
			}
		}

		messages.push(new HumanMessage(userMessage));

		logger.info(`Built message chain with ${messages.length} messages (${limitedHistory.length} from history)`);
		return messages;
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const chatModel = ReveniumAnthropicAIAgent.getChatModel(this);
				const memory = await ReveniumAnthropicAIAgent.getMemoryConnection(this);
				const tools = await ReveniumAnthropicAIAgent.getToolConnections(this);

				const systemMessage = this.getNodeParameter('systemMessage', i) as string;
				const requireFormat = this.getNodeParameter('requireFormat', i) as boolean;
				const memoryOptions = this.getNodeParameter('memoryOptions', i, {}) as N8nMemoryOptions;
				const toolOptions = this.getNodeParameter('toolOptions', i, {}) as N8nToolOptions;

				const userMessage = ReveniumAnthropicAIAgent.getUserMessage(this, i, items);
				logger.info(`Processing user message: "${userMessage}"`);

				const conversationHistory = await ReveniumAnthropicAIAgent.loadConversationHistory(memory, memoryOptions);

				const toolSchemas = ReveniumAnthropicAIAgent.extractToolSchemas(tools);
				logger.info(`Total tool schemas created: ${toolSchemas.length}`);

				const messages = ReveniumAnthropicAIAgent.buildMessages(
					this,
					i,
					systemMessage,
					userMessage,
					conversationHistory,
					toolSchemas,
					memoryOptions,
					requireFormat
				);

				logger.debug('Debugging chatModel structure: %O', {
					isArray: Array.isArray(chatModel),
					type: typeof chatModel,
					constructor: chatModel?.constructor?.name,
					keys: Object.keys(chatModel || {}),
					firstElement: Array.isArray(chatModel) ? chatModel[0]?.constructor?.name : 'N/A'
				});

				const resolvedModel = await chatModel;
				logger.debug('Resolved model structure: %O', {
					isArray: Array.isArray(resolvedModel),
					type: typeof resolvedModel,
					constructor: resolvedModel?.constructor?.name,
					keys: Object.keys(resolvedModel || {}),
					firstElement: Array.isArray(resolvedModel) ? resolvedModel[0]?.constructor?.name : 'N/A'
				});

				const actualModel = Array.isArray(resolvedModel) ? resolvedModel[0] : resolvedModel;
				logger.debug('Actual model details: %O', {
					hasInvoke: typeof actualModel?.invoke === 'function',
					hasCall: typeof actualModel?.call === 'function',
					hasGenerate: typeof actualModel?._generate === 'function',
				});

				if (typeof actualModel?.invoke !== 'function') {
					throw new Error('Connected chat model does not have invoke method. Please ensure you connect a valid Chat Model.');
				}

				logger.info('Calling chat model with messages...');

				const timeouts = getTimeoutConfig();

				let response: LangChainMessage;
				const modelTimeout = timeouts.modelInvocation;

				try {
					const modelInvocation = toolSchemas.length > 0
						? actualModel.invoke(messages, {
							tools: toolSchemas,
							tool_choice: toolOptions.toolChoice || 'auto'
						})
						: actualModel.invoke(messages);

					response = await Promise.race([
						modelInvocation,
						new Promise<never>((_, reject) =>
							setTimeout(() => reject(new Error(`Model invocation timeout after ${modelTimeout}ms`)), modelTimeout)
						)
					]);

					if (!response || typeof response !== 'object') {
						throw new Error('Invalid response from chat model');
					}

					logger.info('Model response received: %O', {
						hasContent: !!response.content,
						contentLength: typeof response.content === 'string' ? response.content.length : 0,
						hasToolCalls: Array.isArray(response.tool_calls),
						toolCallCount: Array.isArray(response.tool_calls) ? response.tool_calls.length : 0
					});
				} catch (error) {
					const errorDetails = getErrorDetails(error);
					logger.error('Error calling chat model: %s', errorDetails.message);

					if (process.env.NODE_ENV === 'development') {
						logger.debug('Model invocation error details: %O', errorDetails);
					}

					throw new NodeOperationError(this.getNode(), `Chat model invocation failed: ${errorDetails.message}`);
				}

				if (Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
					logger.info('Processing %d tool calls...', response.tool_calls.length);

					const maxIterations = toolOptions.maxIterations || 5;
					let iterationCount = 0;

					for (const toolCall of response.tool_calls) {
						if (iterationCount >= maxIterations) {
							logger.warning('Maximum tool iterations (%d) reached, skipping remaining tools', maxIterations);
							break;
						}

						try {
							if (!toolCall || typeof toolCall !== 'object' ||
								!toolCall.name || typeof toolCall.name !== 'string' ||
								!toolCall.args || typeof toolCall.args !== 'object') {
								logger.error('Invalid tool call structure: %O', toolCall);
								continue;
							}

							logger.debug('Executing tool: %s with args: %O', toolCall.name, toolCall.args);

							const tool = tools.find((t: { name: string; description?: unknown; call?: Function; invoke?: Function }) => t.name === toolCall.name);
							if (!tool) {
								logger.error('Tool not found: %s', toolCall.name);
								continue;
							}

							const toolTimeout = timeouts.toolExecution;

							const toolExecution = typeof tool.call === 'function'
								? tool.call(toolCall.args)
								: typeof tool.invoke === 'function'
								? tool.invoke(toolCall.args)
								: Promise.reject(new Error(`Tool ${toolCall.name} has no call or invoke method`));

							const toolResult: unknown = await Promise.race([
								toolExecution,
								new Promise<never>((_, reject) =>
									setTimeout(() => reject(new Error(`Tool execution timeout after ${toolTimeout}ms`)), toolTimeout)
								)
							]);

							logger.debug('Tool %s result: %O', toolCall.name, toolResult);

							if (memory && toolOptions.saveToolCalls !== false) {
								try {
									const safeStringify = (obj: unknown): string => {
										try {
											return JSON.stringify(obj);
										} catch {
											return String(obj);
										}
									};

									const toolInteraction = `Tool: ${toolCall.name}\nInput: ${safeStringify(toolCall.args)}\nResult: ${safeStringify(toolResult)}`;

									if (hasSaveContext(memory)) {
										await memory.saveContext(
											{ input: `[TOOL CALL] ${toolCall.name}` },
											{ output: toolInteraction }
										);
										logger.debug('Saved tool call to memory: %s', toolCall.name);
									}
								} catch (memoryError) {
									const errorDetails = getErrorDetails(memoryError);
									logger.error('Error saving tool call to memory: %s', errorDetails.message);
								}
							}

							iterationCount++;
						} catch (toolError) {
							const errorDetails = getErrorDetails(toolError);
							logger.error('Error executing tool %s: %s', toolCall.name, errorDetails.message);
							if (process.env.NODE_ENV === 'development') {
								logger.debug('Full tool execution error details: %O', errorDetails);
							}
							iterationCount++;
						}
					}
				}

				if (memory && memoryOptions.saveToMemory !== false) {
					try {
						logger.debug('Saving conversation to memory...');

						if (hasSaveContext(memory)) {

							const responseContent = typeof response.content === 'string' ? response.content : String(response.content || '');

							if (responseContent.trim().length === 0) {
								logger.warning('Empty response content, skipping memory save');
							} else {
								await memory.saveContext(
									{ input: userMessage.trim() },
									{ output: responseContent.trim() }
								);
								logger.debug('Conversation saved to memory');
							}
						} else {
							logger.warning('Memory does not support saveContext method');
						}
					} catch (error) {
						const errorDetails = getErrorDetails(error);
						logger.error('Error saving to memory: %s', errorDetails.message);
						if (process.env.NODE_ENV === 'development') {
							logger.debug('Full memory save error details: %O', errorDetails);
						}
					}
				}

				returnData.push({
					json: {
						response: response.content,
						message: response.content,
						full_response: response,
						tool_calls: response.tool_calls || [],
						revenium_tracking: 'Chat model automatically tracked via Revenium Anthropic Chat Model',
						conversation_saved: memoryOptions.saveToMemory !== false && !!memory,
						tools_executed: response.tool_calls?.length || 0,
					},
				});

				logger.debug('AI Agent execution completed successfully');

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				const errorStack = error instanceof Error ? error.stack : undefined;

				logger.error('AI Agent execution error: %s', errorMessage);
				if (errorStack && process.env.NODE_ENV === 'development') {
					logger.debug('Error stack: %s', errorStack);
				}

				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: errorMessage,
							errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
							revenium_tracking: 'failed - error in execution',
						},
					});
					continue;
				}

				if (error instanceof NodeOperationError) {
					throw error;
				}
				throw new NodeOperationError(this.getNode(), errorMessage);
			}
		}

		return [returnData];
	}
}

// One model turn with tools, shared by the buyers' shopping assistant and the owner's assistant: the model
// calls tools until it has an answer or runs out of rounds. Each caller brings its own prompt, its own
// tools and its own `run`, which decides what a call may do; a name outside the tools given never runs.

import type { ChatMessage, ChatModel } from './llm.ts';

export interface LoopTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** Runs one tool; tool errors come back as results the model can read and fix. */
export type RunTool = (name: string, args: unknown) => Promise<{ isError: boolean; result: unknown }>;

/** What the person sees for one turn: each tool the assistant used, and what it said. */
export type LoopStep = { tool: string; args: unknown; result: unknown; isError: boolean } | { text: string };

export interface LoopLimits {
  rounds: number;
  /** Characters of one tool result the model reads back. */
  toolChars: number;
  /** Tool calls in one turn, across rounds. */
  calls?: number;
}

export async function toolLoop(deps: { model: ChatModel; tools: LoopTool[]; run: RunTool }, system: string[], start: ChatMessage[], limits: LoopLimits) {
  if (!deps.model.chat) throw new Error(`${deps.model.name} can't use tools`);
  const messages = [...start];
  const steps: LoopStep[] = [];
  const tools = deps.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema }));
  const prompt: ChatMessage[] = system.map((content) => ({ role: 'system', content }));
  let calls = 0;
  for (let round = 0; round < limits.rounds; round++) {
    const reply = await deps.model.chat({ messages: [...prompt, ...messages], tools });
    messages.push({ role: 'assistant', content: reply.content || null, ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls } : {}) });
    if (reply.content) steps.push({ text: reply.content });
    if (reply.toolCalls.length === 0) return { messages, steps };
    for (const call of reply.toolCalls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      const known = deps.tools.some((t) => t.name === call.function.name);
      const allowed = limits.calls === undefined || calls < limits.calls;
      const out = !known
        ? { isError: true, result: `There is no tool called ${call.function.name}.` }
        : !allowed
          ? { isError: true, result: 'That is enough tool calls for one answer. Answer with what you have.' }
          : await deps.run(call.function.name, args);
      if (known && allowed) calls++;
      steps.push({ tool: call.function.name, args, result: out.result, isError: out.isError });
      const content = typeof out.result === 'string' ? out.result : JSON.stringify(out.result);
      messages.push({ role: 'tool', tool_call_id: call.id, content: content.slice(0, limits.toolChars) });
    }
  }
  steps.push({ text: "That took more steps than I'm allowed in one go. Tell me what to do next and I'll continue." });
  return { messages, steps };
}

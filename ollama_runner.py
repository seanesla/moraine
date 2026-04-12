"""
Ollama API wrapper for Gemma with tool-calling support.

Handles the conversation loop:
1. Send user message + system prompt + tools to Ollama
2. If Gemma responds with a tool call → execute it via gemma_tools.py
3. Send the tool result back to Gemma
4. Gemma generates the final response
5. Return to UI

Usage:
    runner = OllamaRunner(model="gemma3:4b")
    response = runner.chat("Imja lake just burst. How long do I have?")
    print(response)
"""

import json
import os
import ollama
from gemma_prompts import SYSTEM_PROMPT
from gemma_tools import TOOLS, execute_tool

DEFAULT_MODEL = os.environ.get("GLOF_MODEL", "gemma4:e4b")


class OllamaRunner:
    """Manages a conversation with Gemma via Ollama, including tool calls."""

    def __init__(self, model: str = DEFAULT_MODEL):
        """
        Initialize the runner.

        Args:
            model: Ollama model name. Use "gemma3:4b" or "gemma3:12b"
                   (or "gemma4:..." when available).
        """
        self.model = model
        self.messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
        ]

    def chat(self, user_message: str) -> dict:
        """
        Send a message to Gemma and get a response, handling any tool calls.

        Args:
            user_message: The user's input text.

        Returns:
            Dict with:
              - response: The final text response from Gemma
              - tool_calls: List of tool calls that were made (name + result)
              - error: Error message if something went wrong (None if OK)
        """
        self.messages.append({"role": "user", "content": user_message})

        tool_calls_made = []

        try:
            # First call to Gemma — may return a tool call or a direct response
            response = ollama.chat(
                model=self.model,
                messages=self.messages,
                tools=TOOLS,
            )
        except Exception as e:
            return {
                "response": None,
                "tool_calls": [],
                "error": f"Failed to connect to Ollama: {e}",
            }

        # Handle tool calls in a loop (Gemma might chain multiple calls)
        max_tool_rounds = 5  # Safety limit to prevent infinite loops
        rounds = 0

        while response.message.tool_calls and rounds < max_tool_rounds:
            rounds += 1

            for tool_call in response.message.tool_calls:
                tool_name = tool_call.function.name
                tool_args = tool_call.function.arguments

                # Execute the tool
                tool_result = execute_tool(tool_name, tool_args)

                tool_calls_made.append({
                    "name": tool_name,
                    "arguments": tool_args,
                    "result": json.loads(tool_result),
                })

                # Add the assistant's tool call and the tool result to history
                self.messages.append(response.message)
                self.messages.append({
                    "role": "tool",
                    "content": tool_result,
                })

            # Call Gemma again with the tool results
            try:
                response = ollama.chat(
                    model=self.model,
                    messages=self.messages,
                    tools=TOOLS,
                )
            except Exception as e:
                return {
                    "response": None,
                    "tool_calls": tool_calls_made,
                    "error": f"Ollama error after tool call: {e}",
                }

        # Final response (no more tool calls)
        final_text = response.message.content
        self.messages.append({"role": "assistant", "content": final_text})

        return {
            "response": final_text,
            "tool_calls": tool_calls_made,
            "error": None,
        }

    def reset(self):
        """Clear conversation history and start fresh."""
        self.messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
        ]


def chat_loop():
    """Simple terminal chat loop for testing. Run: python3 ollama_runner.py"""
    print("GLOF Warning Assistant (type 'quit' to exit, 'reset' to clear history)")
    print("=" * 60)

    runner = OllamaRunner()

    while True:
        try:
            user_input = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye.")
            break

        if not user_input:
            continue
        if user_input.lower() == "quit":
            break
        if user_input.lower() == "reset":
            runner.reset()
            print("Conversation reset.")
            continue

        result = runner.chat(user_input)

        if result["error"]:
            print(f"\nError: {result['error']}")
            continue

        if result["tool_calls"]:
            print(f"\n[Used {len(result['tool_calls'])} tool(s): "
                  f"{', '.join(tc['name'] for tc in result['tool_calls'])}]")

        print(f"\nAssistant: {result['response']}")


if __name__ == "__main__":
    chat_loop()

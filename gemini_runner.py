"""
Google AI Studio (Gemini) API wrapper with tool-calling support.

Drop-in replacement for OllamaRunner that uses Google's Gemini API
instead of local Ollama. Same chat() interface, same return format.

Usage:
    runner = GeminiRunner()  # reads GEMINI_API_KEY from .env
    response = runner.chat("Imja lake just burst. How long do I have?")
"""

import json
import os
from dotenv import load_dotenv
from google import genai
from google.genai import types
from gemma_prompts import SYSTEM_PROMPT
from gemma_tools import execute_tool

load_dotenv()

# Convert our Ollama-format tool definitions to Google's format
GOOGLE_TOOLS = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="calculate_glof_scenario",
            description=(
                "Calculate flood arrival times for downstream villages after a "
                "glacial lake outburst flood (GLOF). Returns peak discharge, "
                "flow velocity, wave speed, and arrival times for each village "
                "sorted by arrival order."
            ),
            parameters={
                "type": "OBJECT",
                "properties": {
                    "lake_volume_m3": {
                        "type": "NUMBER",
                        "description": "Lake volume in cubic meters",
                    },
                    "valley_slope": {
                        "type": "NUMBER",
                        "description": "Average valley slope (dimensionless, e.g., 0.04 means 4% grade)",
                    },
                    "channel_width_m": {
                        "type": "NUMBER",
                        "description": "River channel width in meters",
                    },
                    "channel_depth_m": {
                        "type": "NUMBER",
                        "description": "Average channel depth in meters",
                    },
                    "manning_n": {
                        "type": "NUMBER",
                        "description": "Manning's roughness coefficient (0.05-0.10 for mountain rivers)",
                    },
                    "villages": {
                        "type": "ARRAY",
                        "description": "List of downstream villages with name and distance",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "name": {"type": "STRING"},
                                "distance_km": {"type": "NUMBER"},
                                "name_nepali": {"type": "STRING"},
                            },
                            "required": ["name", "distance_km"],
                        },
                    },
                },
                "required": [
                    "lake_volume_m3",
                    "valley_slope",
                    "channel_width_m",
                    "channel_depth_m",
                    "manning_n",
                    "villages",
                ],
            },
        ),
        types.FunctionDeclaration(
            name="validate_inputs",
            description=(
                "Check if user-provided GLOF parameters are physically reasonable. "
                "Returns a list of warnings. Empty list means all inputs look OK."
            ),
            parameters={
                "type": "OBJECT",
                "properties": {
                    "lake_volume_m3": {"type": "NUMBER"},
                    "valley_slope": {"type": "NUMBER"},
                    "channel_width_m": {"type": "NUMBER"},
                    "manning_n": {"type": "NUMBER"},
                    "channel_depth_m": {"type": "NUMBER"},
                },
                "required": ["lake_volume_m3", "valley_slope", "channel_width_m", "manning_n"],
            },
        ),
    ]
)

DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemma-4-31b-it")


class GeminiRunner:
    """Manages a conversation with Gemma/Gemini via Google AI Studio, including tool calls."""

    def __init__(self, model: str = DEFAULT_MODEL):
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not set. Add it to .env file.")

        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.contents = []

    def chat(self, user_message: str) -> dict:
        """
        Send a message and get a response, handling any tool calls.

        Returns same format as OllamaRunner:
            {response: str, tool_calls: list, error: str|None}
        """
        self.contents.append(
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=user_message)],
            )
        )

        tool_calls_made = []

        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=self.contents,
                config=types.GenerateContentConfig(
                    tools=[GOOGLE_TOOLS],
                    system_instruction=SYSTEM_PROMPT,
                ),
            )
        except Exception as e:
            return {"response": None, "tool_calls": [], "error": f"Gemini API error: {e}"}

        # Handle tool calls in a loop
        max_rounds = 8
        rounds = 0

        while response.function_calls and rounds < max_rounds:
            rounds += 1

            # Add the model's response (with function calls) to history
            self.contents.append(response.candidates[0].content)

            # Execute each function call
            function_response_parts = []
            for fc in response.function_calls:
                tool_name = fc.name
                tool_args = dict(fc.args)

                tool_result = execute_tool(tool_name, tool_args)

                tool_calls_made.append({
                    "name": tool_name,
                    "arguments": tool_args,
                    "result": json.loads(tool_result),
                })

                function_response_parts.append(
                    types.Part.from_function_response(
                        name=tool_name,
                        response={"result": json.loads(tool_result)},
                    )
                )

            # Send tool results back to model
            self.contents.append(
                types.Content(role="tool", parts=function_response_parts)
            )

            try:
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=self.contents,
                    config=types.GenerateContentConfig(
                        tools=[GOOGLE_TOOLS],
                        system_instruction=SYSTEM_PROMPT,
                    ),
                )
            except Exception as e:
                return {
                    "response": None,
                    "tool_calls": tool_calls_made,
                    "error": f"Gemini API error after tool call: {e}",
                }

        # Final text response
        final_text = response.text if response.text else ""
        self.contents.append(
            types.Content(
                role="model",
                parts=[types.Part.from_text(text=final_text)],
            )
        )

        return {
            "response": final_text,
            "tool_calls": tool_calls_made,
            "error": None,
        }

    def reset(self):
        """Clear conversation history."""
        self.contents = []


def chat_loop():
    """Terminal chat loop for testing."""
    print("GLOF Warning Assistant — Google AI Studio")
    print(f"Model: {DEFAULT_MODEL}")
    print("=" * 60)

    runner = GeminiRunner()

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

        print(f"\nMoraine: {result['response']}")


if __name__ == "__main__":
    chat_loop()

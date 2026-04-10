"""
Tool definitions for Gemma function calling.

These define what functions Gemma can call during a conversation.
When Gemma decides to call a tool, ollama_runner.py executes the
corresponding Python function and returns the result to Gemma.
"""

import json
from glof_core import compute_full_scenario, validate_inputs


# ── Tool schemas (sent to Gemma so it knows what functions are available) ─────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "calculate_glof_scenario",
            "description": (
                "Calculate flood arrival times for downstream villages after a "
                "glacial lake outburst flood (GLOF). Returns peak discharge, "
                "flow velocity, wave speed, and arrival times for each village "
                "sorted by arrival order."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "lake_volume_m3": {
                        "type": "number",
                        "description": "Lake volume in cubic meters",
                    },
                    "valley_slope": {
                        "type": "number",
                        "description": "Average valley slope (dimensionless, e.g., 0.04 means 4% grade)",
                    },
                    "channel_width_m": {
                        "type": "number",
                        "description": "River channel width in meters",
                    },
                    "channel_depth_m": {
                        "type": "number",
                        "description": "Average channel depth in meters",
                    },
                    "manning_n": {
                        "type": "number",
                        "description": "Manning's roughness coefficient (0.05-0.10 for mountain rivers)",
                    },
                    "villages": {
                        "type": "array",
                        "description": "List of downstream villages with name and distance",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "distance_km": {"type": "number"},
                                "name_nepali": {"type": "string"},
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
        },
    },
    {
        "type": "function",
        "function": {
            "name": "validate_inputs",
            "description": (
                "Check if user-provided GLOF parameters are physically reasonable. "
                "Returns a list of warnings. Empty list means all inputs look OK."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "lake_volume_m3": {"type": "number"},
                    "valley_slope": {"type": "number"},
                    "channel_width_m": {"type": "number"},
                    "manning_n": {"type": "number"},
                    "channel_depth_m": {"type": "number"},
                },
                "required": ["lake_volume_m3", "valley_slope", "channel_width_m", "manning_n"],
            },
        },
    },
]


# ── Tool execution (maps tool name → Python function) ────────────────────────

def execute_tool(tool_name: str, arguments: dict) -> str:
    """
    Execute a tool call from Gemma and return the result as a JSON string.

    Args:
        tool_name: Name of the tool Gemma wants to call.
        arguments: Dict of arguments Gemma provided.

    Returns:
        JSON string with the tool's result.
    """
    if tool_name == "calculate_glof_scenario":
        result = compute_full_scenario(
            lake_volume_m3=arguments["lake_volume_m3"],
            valley_slope=arguments["valley_slope"],
            channel_width_m=arguments["channel_width_m"],
            channel_depth_m=arguments["channel_depth_m"],
            manning_n=arguments["manning_n"],
            villages=arguments["villages"],
        )
        return json.dumps(result, indent=2)

    elif tool_name == "validate_inputs":
        warnings = validate_inputs(
            lake_volume_m3=arguments["lake_volume_m3"],
            valley_slope=arguments["valley_slope"],
            channel_width_m=arguments["channel_width_m"],
            manning_n=arguments["manning_n"],
            channel_depth_m=arguments.get("channel_depth_m"),
        )
        return json.dumps({"warnings": warnings, "valid": len(warnings) == 0})

    else:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

"""
Moraine — GLOF Disaster Response Agent

Conversation-first Streamlit app where Gemma is the primary interface.
The sidebar provides quick parameter inputs, but the main panel is a
chat with Gemma that renders inline visualizations (countdown cards,
arrival time charts, flood path maps) when simulations are run.
"""

import json
import os
import time
import streamlit as st
import plotly.graph_objects as go
import folium
from streamlit_folium import st_folium
from glof_core import compute_full_scenario, validate_inputs
from tile_manager import tiles_exist, download_tiles, start_tile_server, get_lake_bounds, count_tiles

# ── Page config ──────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="Moraine — GLOF Response Agent",
    page_icon="🏔️",
    layout="wide",
)

# ── Load lake database ───────────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

with open(os.path.join(DATA_DIR, "lakes.json")) as f:
    LAKES_DB = json.load(f)

LAKE_OPTIONS = {lake["name"]: lake for lake in LAKES_DB["lakes"]}

# ── Session state initialization ─────────────────────────────────────────────

if "messages" not in st.session_state:
    st.session_state.messages = []
if "runner" not in st.session_state:
    st.session_state.runner = None
if "pending_sidebar_msg" not in st.session_state:
    st.session_state.pending_sidebar_msg = None

# ── Custom CSS ───────────────────────────────────────────────────────────────

st.markdown("""
<style>
    .countdown-card {
        border-radius: 12px;
        padding: 20px 28px;
        margin-bottom: 14px;
        color: white;
        font-family: 'Courier New', monospace;
    }
    .severity-extreme { background: linear-gradient(135deg, #b91c1c, #dc2626); }
    .severity-severe { background: linear-gradient(135deg, #c2410c, #ea580c); }
    .severity-high { background: linear-gradient(135deg, #d97706, #f59e0b); }
    .severity-moderate { background: linear-gradient(135deg, #ca8a04, #eab308); color: #1a1a1a; }
    .severity-low { background: linear-gradient(135deg, #15803d, #22c55e); }

    .village-name {
        font-size: 1.6rem;
        font-weight: 800;
        letter-spacing: 1px;
    }
    .village-nepali {
        font-size: 1.2rem;
        opacity: 0.9;
        margin-top: -4px;
    }
    .arrival-time {
        font-size: 2.8rem;
        font-weight: 900;
        letter-spacing: 2px;
    }
    .arrival-range {
        font-size: 0.95rem;
        opacity: 0.85;
    }
    .village-meta {
        font-size: 0.9rem;
        opacity: 0.8;
        margin-top: 4px;
    }

    .alert-header {
        background: linear-gradient(135deg, #7f1d1d, #991b1b);
        color: white;
        padding: 24px 32px;
        border-radius: 12px;
        text-align: center;
        margin-bottom: 20px;
    }
    .alert-header h1 {
        font-size: 2rem;
        margin: 0;
        letter-spacing: 3px;
    }
    .alert-header p {
        font-size: 1.1rem;
        opacity: 0.9;
        margin-top: 8px;
    }

    .disclaimer {
        background: #1e293b;
        color: #94a3b8;
        padding: 16px 20px;
        border-radius: 8px;
        font-size: 0.85rem;
        margin-top: 24px;
        border-left: 4px solid #475569;
    }

    .countdown-live {
        font-size: 4rem;
        font-weight: 900;
        font-family: 'Courier New', monospace;
        text-align: center;
        color: white;
        background: linear-gradient(135deg, #7f1d1d, #b91c1c);
        padding: 40px;
        border-radius: 16px;
        letter-spacing: 4px;
    }
    .countdown-village-label {
        text-align: center;
        font-size: 1.3rem;
        color: #e2e8f0;
        margin-top: 12px;
    }

    .welcome-card {
        background: #0f172a;
        border: 1px solid #1e3a5f;
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 12px;
    }
    .welcome-card h3 {
        color: #a5f3fc;
        margin-top: 0;
    }
    .welcome-card p {
        color: #94a3b8;
    }
</style>
""", unsafe_allow_html=True)


# ── Severity color map ────────────────────────────────────────────────���──────

SEVERITY_COLORS = {
    "EXTREME": "#dc2626",
    "SEVERE": "#ea580c",
    "HIGH": "#f59e0b",
    "MODERATE": "#eab308",
    "LOW": "#22c55e",
}


# ── Visualization helpers ────────────────────────────────────────────────────

def severity_css_class(severity: str) -> str:
    return f"severity-{severity.lower()}"


def render_countdown_card(village: dict):
    """Render a single village countdown card."""
    css_class = severity_css_class(village["severity"])
    nepali = village.get("name_nepali", "")
    nepali_html = f'<div class="village-nepali">{nepali}</div>' if nepali else ""
    pop = village.get("population", "")
    pop_html = f" | Pop: ~{pop:,}" if pop else ""

    st.markdown(f"""
    <div class="countdown-card {css_class}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
                <div class="village-name">{village['name'].upper()}</div>
                {nepali_html}
                <div class="village-meta">{village['distance_km']} km downstream{pop_html}</div>
            </div>
            <div style="text-align: right;">
                <div class="arrival-time">{village['arrival_time_min']:.0f} min</div>
                <div class="arrival-range">Range: {village['arrival_time_low_min']:.0f}\u2013{village['arrival_time_high_min']:.0f} min</div>
                <div class="village-meta">{village['severity']}</div>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)


def render_arrival_chart(result: dict):
    """Render a plotly horizontal bar chart of arrival times by village."""
    villages = result["villages"]
    names = [f"{v['name']}" for v in villages]
    times = [v["arrival_time_min"] for v in villages]
    lows = [v["arrival_time_low_min"] for v in villages]
    highs = [v["arrival_time_high_min"] for v in villages]
    colors = [SEVERITY_COLORS.get(v["severity"], "#888") for v in villages]

    # Error bars: distance from center to low/high
    error_minus = [t - l for t, l in zip(times, lows)]
    error_plus = [h - t for t, h in zip(times, highs)]

    fig = go.Figure()
    fig.add_trace(go.Bar(
        y=names,
        x=times,
        orientation="h",
        marker_color=colors,
        error_x=dict(
            type="data",
            symmetric=False,
            array=error_plus,
            arrayminus=error_minus,
            color="rgba(255,255,255,0.5)",
            thickness=2,
            width=6,
        ),
        text=[f"{t:.0f} min" for t in times],
        textposition="outside",
        textfont=dict(color="white", size=13),
    ))

    fig.update_layout(
        title=dict(text="Flood Arrival Time by Village", font=dict(color="white", size=16)),
        xaxis=dict(
            title="Minutes after breach",
            color="white",
            gridcolor="rgba(255,255,255,0.1)",
        ),
        yaxis=dict(color="white", autorange="reversed"),
        plot_bgcolor="#0f172a",
        paper_bgcolor="#0f172a",
        font=dict(color="white"),
        margin=dict(l=10, r=40, t=50, b=40),
        height=max(250, len(villages) * 70 + 100),
    )

    st.plotly_chart(fig, use_container_width=True)


def render_flood_map(result: dict, lake_data: dict):
    """Render a folium map with offline tiles showing lake and village locations."""
    lake_lat = lake_data.get("lat")
    lake_lon = lake_data.get("lon")
    lake_id = lake_data.get("id")
    if not lake_lat or not lake_lon:
        return

    # Collect villages with coordinates
    villages_with_coords = []
    for v in result["villages"]:
        matching = [lv for lv in lake_data.get("villages", []) if lv["name"] == v["name"]]
        if matching and "lat" in matching[0]:
            villages_with_coords.append({**v, "lat": matching[0]["lat"], "lon": matching[0]["lon"]})

    if not villages_with_coords:
        return

    # Determine tile source — local if available, otherwise OpenTopoMap online
    tile_url = None
    tile_attr = "OpenTopoMap contributors"
    if lake_id and tiles_exist(lake_id):
        tile_url = start_tile_server(lake_id)

    # Center between lake and villages
    all_lats = [lake_lat] + [v["lat"] for v in villages_with_coords]
    all_lons = [lake_lon] + [v["lon"] for v in villages_with_coords]
    center_lat = sum(all_lats) / len(all_lats)
    center_lon = sum(all_lons) / len(all_lons)

    if tile_url:
        m = folium.Map(location=[center_lat, center_lon], zoom_start=11,
                       tiles=tile_url, attr=tile_attr)
    else:
        m = folium.Map(location=[center_lat, center_lon], zoom_start=11,
                       tiles="OpenStreetMap")

    # Lake marker
    folium.CircleMarker(
        location=[lake_lat, lake_lon],
        radius=12,
        color="#3b82f6",
        fill=True,
        fill_color="#3b82f6",
        fill_opacity=0.8,
        popup=folium.Popup(f"<b>{lake_data['name']}</b><br/>Glacial Lake", max_width=200),
    ).add_to(m)

    # Village markers — colored by severity, sized by population
    for v in villages_with_coords:
        color = SEVERITY_COLORS.get(v["severity"], "#888888")
        pop = v.get("population", 100)
        radius = max(6, min(18, pop / 100))
        nepali = v.get("name_nepali", "")
        nepali_html = f"<br/>{nepali}" if nepali else ""

        folium.CircleMarker(
            location=[v["lat"], v["lon"]],
            radius=radius,
            color=color,
            fill=True,
            fill_color=color,
            fill_opacity=0.8,
            popup=folium.Popup(
                f"<b>{v['name']}</b>{nepali_html}<br/>"
                f"Arrival: {v['arrival_time_min']:.0f} min<br/>"
                f"Severity: {v['severity']}<br/>"
                f"Pop: ~{pop:,}",
                max_width=200,
            ),
        ).add_to(m)

        # Line from lake to village
        folium.PolyLine(
            locations=[[lake_lat, lake_lon], [v["lat"], v["lon"]]],
            color=color,
            weight=2,
            opacity=0.6,
            dash_array="5",
        ).add_to(m)

    st_folium(m, use_container_width=True, height=400, returned_objects=[])


def render_tool_result(tool_name: str, result: dict, lake_data: dict = None):
    """Dispatch visualization rendering based on tool name."""
    if tool_name == "calculate_glof_scenario":
        # Alert header
        st.markdown(f"""
        <div class="alert-header">
            <h1>\u26a0\ufe0f GLOF SIMULATION RESULT</h1>
            <p>Peak discharge: {result['discharge']['average_m3s']:,.0f} m\u00b3/s |
            Wave speed: {result['wave_speed_mps']:.1f} m/s |
            Flow velocity: {result['flow_velocity_mps']:.1f} m/s</p>
        </div>
        """, unsafe_allow_html=True)

        # Countdown cards
        for village in result["villages"]:
            render_countdown_card(village)

        # Arrival time chart
        render_arrival_chart(result)

        # Map (if we have coordinate data)
        if lake_data:
            render_flood_map(result, lake_data)

    elif tool_name == "validate_inputs":
        if result.get("warnings"):
            for w in result["warnings"]:
                st.warning(w)
        else:
            st.success("All parameters look reasonable.")


# ── Initialize Gemma runner ──────────────────────────────────────────────────

def get_runner():
    """Get or create the runner instance. Prefers Gemini API if key is set, falls back to Ollama."""
    if st.session_state.runner is None:
        # Try Google AI Studio first (faster for testing)
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            from dotenv import load_dotenv
            load_dotenv()
            api_key = os.environ.get("GEMINI_API_KEY")

        if api_key:
            try:
                from gemini_runner import GeminiRunner
                st.session_state.runner = GeminiRunner()
                return st.session_state.runner
            except Exception as e:
                st.sidebar.warning(f"Gemini init failed: {e}")

        # Fall back to Ollama
        try:
            from ollama_runner import OllamaRunner
            st.session_state.runner = OllamaRunner()
        except Exception:
            st.session_state.runner = None
    return st.session_state.runner


def process_message(user_message: str):
    """Send a message to Gemma, handle response and tool calls."""
    runner = get_runner()
    if runner is None:
        return {
            "response": "Could not connect to Ollama. Make sure it's running: `ollama serve`",
            "tool_calls": [],
            "error": "Ollama not available",
        }

    return runner.chat(user_message)


def find_lake_for_result(tool_calls: list) -> dict | None:
    """Try to find which lake was used in a simulation from the tool call arguments."""
    for tc in tool_calls:
        if tc["name"] == "calculate_glof_scenario":
            args = tc.get("arguments", {})
            villages_arg = args.get("villages", [])
            # Match against lake database by checking village names
            for lake in LAKES_DB["lakes"]:
                lake_village_names = {v["name"] for v in lake["villages"]}
                arg_village_names = {v["name"] for v in villages_arg}
                if arg_village_names & lake_village_names:
                    return lake
    return None


# ── Sidebar ──────────────────────────────────────────────────────────────────

with st.sidebar:
    st.title("Moraine")
    st.caption("GLOF Disaster Response Agent")

    st.divider()

    # Lake selection
    selected_lake_name = st.selectbox(
        "Select Glacial Lake",
        options=list(LAKE_OPTIONS.keys()),
        index=0,
    )
    selected_lake = LAKE_OPTIONS[selected_lake_name]

    st.divider()
    st.subheader("Lake & Valley Parameters")

    lake_volume = st.number_input(
        "Lake Volume (million m\u00b3)",
        min_value=0.1,
        max_value=1000.0,
        value=selected_lake["volume_m3"] / 1_000_000,
        step=1.0,
        help="Volume of water in the lake in millions of cubic meters",
    )
    lake_volume_m3 = lake_volume * 1_000_000

    valley_slope = st.slider(
        "Valley Slope",
        min_value=0.005,
        max_value=0.15,
        value=selected_lake["valley_slope"],
        step=0.005,
        format="%.3f",
        help="Average slope of the valley downstream (0.04 = 4% grade)",
    )

    channel_width = st.number_input(
        "Channel Width (m)",
        min_value=1.0,
        max_value=500.0,
        value=float(selected_lake["channel_width_m"]),
        step=5.0,
    )

    channel_depth = st.number_input(
        "Channel Depth (m)",
        min_value=0.5,
        max_value=30.0,
        value=float(selected_lake["channel_depth_m"]),
        step=0.5,
    )

    manning_n = st.slider(
        "Manning's Roughness (n)",
        min_value=0.03,
        max_value=0.15,
        value=selected_lake["manning_n"],
        step=0.01,
        format="%.2f",
        help="0.03=smooth, 0.07=mountain river, 0.12=debris flow",
    )

    st.divider()
    st.subheader("Downstream Villages")
    for v in selected_lake["villages"]:
        nepali = v.get("name_nepali", "")
        label = f"{v['name']}" + (f" ({nepali})" if nepali else "")
        st.text(f"  {label} \u2014 {v['distance_km']} km")

    st.divider()

    # Offline map tiles
    st.subheader("Offline Map")
    lake_id = selected_lake.get("id")
    if lake_id and tiles_exist(lake_id):
        st.success("Map tiles cached", icon="\u2705")
    elif lake_id and selected_lake.get("lat"):
        bounds = get_lake_bounds(selected_lake)
        tile_count = count_tiles(bounds)
        if st.button(f"Download Map Tiles (~{tile_count} tiles)", use_container_width=True):
            progress = st.progress(0, text="Downloading tiles...")
            def update_progress(done, total):
                progress.progress(done / total, text=f"Downloading tiles... {done}/{total}")
            download_tiles(lake_id, bounds, progress_callback=update_progress)
            progress.empty()
            st.success("Map tiles downloaded!", icon="\u2705")
            st.rerun()
    else:
        st.caption("No coordinates available for this lake.")

    st.divider()

    # Sidebar "Run Scenario" button — injects into chat
    if st.button("RUN SCENARIO", type="primary", use_container_width=True):
        village_list = ", ".join(
            f"{v['name']} ({v['distance_km']}km)" for v in selected_lake["villages"]
        )
        st.session_state.pending_sidebar_msg = (
            f"Run a GLOF scenario for {selected_lake_name} with: "
            f"volume={lake_volume_m3:,.0f} m\u00b3, slope={valley_slope}, "
            f"width={channel_width}m, depth={channel_depth}m, "
            f"Manning's n={manning_n}. "
            f"Downstream villages: {village_list}"
        )


# ── Main panel ───────────────────────────────────────────────────────────────

# Handle pending sidebar message
if st.session_state.pending_sidebar_msg:
    st.session_state.messages.append({
        "role": "user",
        "content": st.session_state.pending_sidebar_msg,
    })
    st.session_state.pending_sidebar_msg = None

# Welcome screen when no messages
if not st.session_state.messages:
    st.markdown("""
    <div class="welcome-card">
        <h3>Moraine \u2014 GLOF Disaster Response Agent</h3>
        <p>I'm Moraine, a disaster response coordinator for Glacial Lake Outburst Floods.
        I can simulate flood scenarios, generate evacuation plans, and create
        emergency alerts in Nepali, Hindi, and English \u2014 all powered by Gemma running
        locally via Ollama.</p>
        <p style="color: #64748b; font-size: 0.85rem;">
        Built for the Gemma 4 Good Hackathon \u2014 Global Resilience Track</p>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("**Try asking:**")
    cols = st.columns(3)
    suggestions = [
        "Imja Tsho just burst. How long until Namche is hit?",
        "Generate an evacuation plan for Tsho Rolpa in Nepali",
        "What would happen if Chorabari burst again like 2013?",
    ]
    for col, suggestion in zip(cols, suggestions):
        with col:
            if st.button(suggestion, use_container_width=True):
                st.session_state.messages.append({"role": "user", "content": suggestion})
                st.rerun()

    st.divider()
    st.markdown("""
    **How many minutes until the flood reaches your village?**

    There are **200+ dangerous glacial lakes** worldwide, and the communities
    downstream often have **no warning system**. Moraine uses validated physics
    (Popov 1991, Huggel 2002, Manning's equation) with Gemma to provide
    intelligent, multilingual disaster response support.

    You can also use the sidebar to select a lake and run a scenario directly.
    """)

else:
    # Render chat history
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            # Render inline visualizations for assistant messages with tool calls
            if msg["role"] == "assistant" and msg.get("tool_calls"):
                lake_data = find_lake_for_result(msg["tool_calls"])
                for tc in msg["tool_calls"]:
                    render_tool_result(tc["name"], tc["result"], lake_data)

    # Check if the last message is from the user and needs a response
    if st.session_state.messages and st.session_state.messages[-1]["role"] == "user":
        with st.chat_message("assistant"):
            with st.spinner("Moraine is analyzing..."):
                response = process_message(st.session_state.messages[-1]["content"])

            if response["error"] and not response["response"]:
                st.error(f"Error: {response['error']}")
                st.info("Make sure Ollama is running: `ollama serve` then `ollama pull gemma3:4b`")
                assistant_msg = {
                    "role": "assistant",
                    "content": f"I couldn't connect to my analysis engine. Error: {response['error']}",
                    "tool_calls": [],
                }
            else:
                st.markdown(response["response"])

                # Render tool result visualizations inline
                lake_data = find_lake_for_result(response.get("tool_calls", []))
                for tc in response.get("tool_calls", []):
                    render_tool_result(tc["name"], tc["result"], lake_data)

                assistant_msg = {
                    "role": "assistant",
                    "content": response["response"],
                    "tool_calls": response.get("tool_calls", []),
                }

            st.session_state.messages.append(assistant_msg)

    # Live countdown clock (available when we have simulation results)
    last_result = None
    for msg in reversed(st.session_state.messages):
        if msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                if tc["name"] == "calculate_glof_scenario":
                    last_result = tc["result"]
                    break
        if last_result:
            break

    if last_result and last_result.get("villages"):
        st.divider()
        col1, col2 = st.columns([1, 1])

        with col1:
            st.subheader("Live Countdown")
            countdown_village = st.selectbox(
                "Countdown for:",
                options=[v["name"] for v in last_result["villages"]],
                index=0,
                key="countdown_select",
            )

            selected_v = next(v for v in last_result["villages"] if v["name"] == countdown_village)
            total_seconds = int(selected_v["arrival_time_min"] * 60)

            if st.button("START COUNTDOWN", type="primary", key="start_countdown"):
                nepali_name = selected_v.get("name_nepali", "")
                label = f"{selected_v['name']}" + (f" / {nepali_name}" if nepali_name else "")

                countdown_placeholder = st.empty()
                label_placeholder = st.empty()

                for remaining in range(total_seconds, -1, -1):
                    mins = remaining // 60
                    secs = remaining % 60

                    if remaining == 0:
                        countdown_placeholder.markdown(
                            '<div class="countdown-live" style="background: linear-gradient(135deg, #450a0a, #7f1d1d);">'
                            'FLOOD ARRIVAL</div>',
                            unsafe_allow_html=True,
                        )
                    else:
                        countdown_placeholder.markdown(
                            f'<div class="countdown-live">{mins:02d}:{secs:02d}</div>',
                            unsafe_allow_html=True,
                        )

                    label_placeholder.markdown(
                        f'<div class="countdown-village-label">{label} \u2014 {selected_v["distance_km"]} km downstream</div>',
                        unsafe_allow_html=True,
                    )
                    time.sleep(1)

        with col2:
            st.subheader("Disclaimer")
            st.markdown("""
            <div class="disclaimer">
                <strong>Disclaimer:</strong> This tool provides estimates based on simplified empirical models
                (Popov 1991, Huggel 2002, Manning's equation). Actual flood behavior depends on dam breach
                mechanism, debris content, channel geometry changes, tributary inflows, and other factors not
                captured here. These estimates are for evacuation planning decision support only, not precise
                predictions. Always follow official evacuation orders when available.
            </div>
            """, unsafe_allow_html=True)

# ── Chat input (always at the bottom) ────────────────────────────────────────

user_input = st.chat_input("Describe your scenario or ask about a glacial lake...")

if user_input:
    st.session_state.messages.append({"role": "user", "content": user_input})
    st.rerun()

"""
GLOF Downstream Arrival Time Calculator — Streamlit App

The main demo UI. Shows:
1. Sidebar with lake/valley parameter inputs
2. Gemma's chain-of-thought reasoning
3. Countdown cards with bilingual village names
4. Live countdown clock
5. Nepali emergency alert generation
6. Chat for follow-up questions
"""

import json
import os
import time
import streamlit as st
from glof_core import compute_full_scenario, validate_inputs

# ── Page config ──────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="GLOF Arrival Time Calculator",
    page_icon="🏔️",
    layout="wide",
)

# ── Load lake database ───────────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

with open(os.path.join(DATA_DIR, "lakes.json")) as f:
    LAKES_DB = json.load(f)

LAKE_OPTIONS = {lake["name"]: lake for lake in LAKES_DB["lakes"]}


# ── Custom CSS for the countdown display ─────────────────────────────────────

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

    .reasoning-box {
        background: #0f172a;
        color: #a5f3fc;
        padding: 20px;
        border-radius: 10px;
        font-family: 'Courier New', monospace;
        font-size: 0.9rem;
        line-height: 1.7;
        white-space: pre-wrap;
        border: 1px solid #1e3a5f;
    }
</style>
""", unsafe_allow_html=True)


# ── Helper functions ─────────────────────────────────────────────────────────

def severity_css_class(severity: str) -> str:
    """Map severity string to CSS class."""
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
                <div class="arrival-range">Range: {village['arrival_time_low_min']:.0f}–{village['arrival_time_high_min']:.0f} min</div>
                <div class="village-meta">{village['severity']}</div>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)


def generate_reasoning_text(result: dict, lake_name: str) -> str:
    """Generate a chain-of-thought style explanation of the calculation."""
    p = result["parameters"]
    d = result["discharge"]

    text = f"""Step 1: Estimating peak discharge for {lake_name}
  Lake volume V = {p['lake_volume_m3']:,.0f} m³

  Popov (1991):  Q_peak = 0.0048 × V^0.896 = {d['popov_m3s']:,.0f} m³/s
  Huggel (2002): Q_peak = 0.00077 × V^1.017 = {d['huggel_m3s']:,.0f} m³/s
  Ensemble average: {d['average_m3s']:,.0f} m³/s (spread: {d['spread_percent']:.0f}%)

Step 2: Calculating flood wave velocity (Manning's equation)
  Channel width W = {p['channel_width_m']} m
  Channel depth D = {p['channel_depth_m']} m
  Hydraulic radius R = (W×D)/(W+2D) = {result['hydraulic_radius_m']:.3f} m
  Manning's n = {p['manning_n']} (mountain river with boulders)
  Valley slope S = {p['valley_slope']}

  V = (1/n) × R^(2/3) × S^(1/2) = {result['flow_velocity_mps']:.2f} m/s

Step 3: Wave front speed
  Wave multiplier = {p['wave_multiplier']}× (empirical dam-break)
  Wave speed = {result['flow_velocity_mps']:.2f} × {p['wave_multiplier']} = {result['wave_speed_mps']:.2f} m/s

Step 4: Arrival times for downstream villages"""

    for v in result["villages"]:
        text += f"""
  {v['name']} ({v['distance_km']} km):
    Time = {v['distance_km']*1000:.0f}m ÷ {result['wave_speed_mps']:.2f} m/s = {v['arrival_time_min']:.1f} minutes
    Attenuated discharge: {v['attenuated_discharge_m3s']:,.0f} m³/s → {v['severity']}"""

    return text


def generate_nepali_alert(result: dict, lake_name: str) -> str:
    """Generate an emergency alert in Nepali (Devanagari script)."""
    alert = f"⚠️ चेतावनी: {lake_name} बाट ग्लेशियल झील विस्फोट बाढी (GLOF)!\n\n"
    alert += "तुरुन्तै उच्च भूमिमा जानुहोस्!\n\n"

    for v in result["villages"]:
        nepali_name = v.get("name_nepali", v["name"])
        alert += (
            f"📍 {nepali_name} ({v['name']}): "
            f"{v['arrival_time_min']:.0f} मिनेटमा बाढी आइपुग्छ "
            f"({v['distance_km']} कि.मी.)\n"
        )

    alert += "\n⚠️ यो अनुमान मात्र हो। तुरुन्तै सुरक्षित स्थानमा जानुहोस्।"
    return alert


# ── Sidebar: inputs ──────────────────────────────────────────────────────────

with st.sidebar:
    st.title("GLOF Calculator")
    st.caption("Glacial Lake Outburst Flood Arrival Time Estimator")

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

    # Editable parameters (pre-filled from selected lake)
    lake_volume = st.number_input(
        "Lake Volume (million m³)",
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
        help="Width of the main river channel in meters",
    )

    channel_depth = st.number_input(
        "Channel Depth (m)",
        min_value=0.5,
        max_value=30.0,
        value=float(selected_lake["channel_depth_m"]),
        step=0.5,
        help="Average depth of the river channel in meters",
    )

    manning_n = st.slider(
        "Manning's Roughness (n)",
        min_value=0.03,
        max_value=0.15,
        value=selected_lake["manning_n"],
        step=0.01,
        format="%.2f",
        help="Roughness coefficient: 0.03=smooth, 0.07=mountain river, 0.12=debris flow",
    )

    st.divider()
    st.subheader("Downstream Villages")
    st.caption("Villages from the selected lake's database")

    # Display villages
    for v in selected_lake["villages"]:
        nepali = v.get("name_nepali", "")
        label = f"{v['name']}" + (f" ({nepali})" if nepali else "")
        st.text(f"  {label} — {v['distance_km']} km")

    st.divider()

    # The big red button
    calculate_clicked = st.button(
        "CALCULATE ARRIVAL TIMES",
        type="primary",
        use_container_width=True,
    )


# ── Main panel ───────────────────────────────────────────────────────────────

if calculate_clicked or st.session_state.get("has_results"):

    # Run validation
    warnings = validate_inputs(lake_volume_m3, valley_slope, channel_width, manning_n, channel_depth)
    if warnings:
        for w in warnings:
            st.warning(w)

    # Run calculation
    result = compute_full_scenario(
        lake_volume_m3=lake_volume_m3,
        valley_slope=valley_slope,
        channel_width_m=channel_width,
        channel_depth_m=channel_depth,
        manning_n=manning_n,
        villages=selected_lake["villages"],
    )

    st.session_state["has_results"] = True
    st.session_state["result"] = result

    # ── Alert header ──
    st.markdown(f"""
    <div class="alert-header">
        <h1>⚠️ GLOF ALERT: {selected_lake_name.upper()}</h1>
        <p>Peak discharge: {result['discharge']['average_m3s']:,.0f} m³/s |
        Wave speed: {result['wave_speed_mps']:.1f} m/s |
        Flow velocity: {result['flow_velocity_mps']:.1f} m/s</p>
    </div>
    """, unsafe_allow_html=True)

    # ── Countdown cards ──
    for village in result["villages"]:
        render_countdown_card(village)

    # ── Gemma's reasoning (collapsible) ──
    with st.expander("Show Calculation Reasoning (Chain of Thought)", expanded=False):
        reasoning = generate_reasoning_text(result, selected_lake_name)
        st.markdown(f'<div class="reasoning-box">{reasoning}</div>', unsafe_allow_html=True)

    st.divider()

    # ── Live countdown clock ──
    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("Live Countdown")
        if result["villages"]:
            first_village = result["villages"][0]
            countdown_village = st.selectbox(
                "Countdown for:",
                options=[v["name"] for v in result["villages"]],
                index=0,
                key="countdown_select",
            )

            # Find the selected village
            selected_v = next(v for v in result["villages"] if v["name"] == countdown_village)
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
                        f'<div class="countdown-village-label">{label} — {selected_v["distance_km"]} km downstream</div>',
                        unsafe_allow_html=True,
                    )
                    time.sleep(1)

    with col2:
        st.subheader("Emergency Alert (Nepali)")
        nepali_alert = generate_nepali_alert(result, selected_lake_name)
        st.code(nepali_alert, language=None)

        st.subheader("Emergency Alert (English)")
        english_alert = f"WARNING: Glacial Lake Outburst Flood from {selected_lake_name}!\n\n"
        english_alert += "EVACUATE TO HIGH GROUND IMMEDIATELY!\n\n"
        for v in result["villages"]:
            english_alert += (
                f"  {v['name']}: {v['arrival_time_min']:.0f} minutes "
                f"({v['distance_km']} km) — {v['severity']}\n"
            )
        english_alert += "\nThese are estimates. Move to safety immediately."
        st.code(english_alert, language=None)

    # ── Disclaimer ──
    st.markdown("""
    <div class="disclaimer">
        <strong>Disclaimer:</strong> This tool provides estimates based on simplified empirical models
        (Popov 1991, Huggel 2002, Manning's equation). Actual flood behavior depends on dam breach
        mechanism, debris content, channel geometry changes, tributary inflows, and other factors not
        captured here. These estimates are for evacuation planning decision support only, not precise
        predictions. Always follow official evacuation orders when available.
    </div>
    """, unsafe_allow_html=True)

    st.divider()

    # ── Chat with Gemma (optional, requires Ollama running) ──
    st.subheader("Ask Follow-up Questions")
    st.caption("Requires Ollama running locally with a Gemma model")

    if "chat_messages" not in st.session_state:
        st.session_state.chat_messages = []

    user_question = st.chat_input("Ask a question (e.g., 'What if only half the lake drains?')")

    if user_question:
        st.session_state.chat_messages.append({"role": "user", "content": user_question})

        try:
            from ollama_runner import OllamaRunner

            if "runner" not in st.session_state:
                st.session_state.runner = OllamaRunner()

            with st.spinner("Gemma is thinking..."):
                response = st.session_state.runner.chat(user_question)

            if response["error"]:
                st.error(f"Ollama error: {response['error']}")
                st.info("Make sure Ollama is running: `ollama serve` then `ollama pull gemma3:4b`")
            else:
                if response["tool_calls"]:
                    st.info(f"Used tools: {', '.join(tc['name'] for tc in response['tool_calls'])}")
                st.session_state.chat_messages.append({
                    "role": "assistant",
                    "content": response["response"],
                })
        except ImportError:
            st.error("Ollama package not installed. Run: pip install ollama")
        except Exception as e:
            st.error(f"Error: {e}")
            st.info("Make sure Ollama is running: `ollama serve` then `ollama pull gemma3:4b`")

    # Display chat history
    for msg in st.session_state.get("chat_messages", []):
        with st.chat_message(msg["role"]):
            st.write(msg["content"])

else:
    # Landing page when no calculation has been run yet
    st.title("GLOF Downstream Arrival Time Calculator")
    st.markdown("""
    ### How many minutes until the flood reaches your village?

    **Glacial Lake Outburst Floods (GLOFs)** are sudden, catastrophic floods caused by the
    failure of natural dams holding back glacial lakes. There are **200+ dangerous glacial
    lakes** worldwide, and the communities downstream often have **no warning system**.

    This tool calculates estimated flood arrival times for downstream villages using
    published hydrological equations, powered by **Gemma** for intelligent reasoning
    and multilingual alerts.

    ---

    **How to use:**
    1. Select a glacial lake from the sidebar (or adjust parameters manually)
    2. Click **CALCULATE ARRIVAL TIMES**
    3. See the countdown for each downstream village
    4. Generate emergency alerts in Nepali and English

    ---

    *Built for the Gemma 4 Good Hackathon — Global Resilience Track*
    """)

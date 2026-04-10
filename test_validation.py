"""
Validation test suite for GLOF core calculations.

Validates against the Dig Tsho GLOF event (August 4, 1985) — the best-documented
GLOF with known timing, velocity, and discharge data.

If these tests don't pass, the calculator can't be trusted.

Sources:
    - Vuichard and Zimmermann 1987
    - Cenderelli and Wohl 2001

Run with: pytest test_validation.py -v
"""

import json
import os
import pytest
from glof_core import (
    peak_discharge_popov,
    peak_discharge_huggel,
    peak_discharge_ensemble,
    hydraulic_radius,
    manning_velocity,
    wave_speed,
    arrival_time_minutes,
    attenuate_discharge,
    severity_category,
    compute_full_scenario,
    validate_inputs,
)


# ── Load validation data ─────────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

with open(os.path.join(DATA_DIR, "validation_dig_tsho.json")) as f:
    DIG_TSHO = json.load(f)

with open(os.path.join(DATA_DIR, "demo_imja.json")) as f:
    IMJA = json.load(f)


# ── Unit tests for individual functions ───────────────────────────────────────


class TestPeakDischarge:
    """Test peak discharge empirical formulas."""

    def test_popov_dig_tsho(self):
        """Popov formula for Dig Tsho volume should give reasonable discharge."""
        volume = DIG_TSHO["lake"]["volume_m3"]  # 5,000,000 m3
        q = peak_discharge_popov(volume)
        # Should be in the ballpark of 1500-2500 m3/s (observed range)
        assert 500 < q < 5000, f"Popov discharge {q:.0f} m3/s outside reasonable range"

    def test_huggel_dig_tsho(self):
        """Huggel formula for Dig Tsho volume should give reasonable discharge."""
        volume = DIG_TSHO["lake"]["volume_m3"]
        q = peak_discharge_huggel(volume)
        assert 500 < q < 10000, f"Huggel discharge {q:.0f} m3/s outside reasonable range"

    def test_ensemble_spread(self):
        """Ensemble should contain both estimates and their average."""
        volume = DIG_TSHO["lake"]["volume_m3"]
        result = peak_discharge_ensemble(volume)
        assert result["low_m3s"] <= result["average_m3s"] <= result["high_m3s"]
        assert result["popov_m3s"] > 0
        assert result["huggel_m3s"] > 0

    def test_popov_imja(self):
        """Popov for Imja (61.7M m3) — published models show ~2000 m3/s at 45km."""
        q = peak_discharge_popov(61_700_000)
        # Peak at source should be much higher; attenuation reduces it downstream
        assert q > 1000, f"Popov discharge for Imja ({q:.0f}) too low"

    def test_zero_volume(self):
        """Zero volume should give zero discharge."""
        assert peak_discharge_popov(0) == 0
        assert peak_discharge_huggel(0) == 0


class TestHydraulicRadius:
    """Test hydraulic radius calculation."""

    def test_known_values(self):
        """R = (W*D)/(W+2D). For W=20, D=4: R = 80/28 = 2.857."""
        r = hydraulic_radius(20, 4)
        assert abs(r - 2.857) < 0.01

    def test_wide_channel(self):
        """Very wide channel: R approaches depth."""
        r = hydraulic_radius(1000, 4)
        assert abs(r - 4.0) < 0.1  # Should be close to 4m

    def test_square_channel(self):
        """Square channel (W=D): R = D/3."""
        r = hydraulic_radius(10, 10)
        assert abs(r - 10 / 3) < 0.01


class TestManningVelocity:
    """Test Manning's equation."""

    def test_dig_tsho_velocity(self):
        """Velocity for Dig Tsho valley parameters should match observed 4-5 m/s."""
        valley = DIG_TSHO["valley"]
        r = hydraulic_radius(valley["channel_width_m"], valley["channel_depth_m"])
        v = manning_velocity(valley["manning_n"], r, valley["slope"])

        targets = DIG_TSHO["validation_targets"]["velocity_mps"]
        assert targets["min"] <= v <= targets["max"], (
            f"Manning velocity {v:.2f} m/s outside target range "
            f"[{targets['min']}, {targets['max']}]"
        )

    def test_smoother_channel_faster(self):
        """Lower Manning's n (smoother) should produce higher velocity."""
        r = hydraulic_radius(20, 4)
        v_rough = manning_velocity(0.08, r, 0.04)
        v_smooth = manning_velocity(0.04, r, 0.04)
        assert v_smooth > v_rough

    def test_steeper_slope_faster(self):
        """Steeper slope should produce higher velocity."""
        r = hydraulic_radius(20, 4)
        v_gentle = manning_velocity(0.07, r, 0.02)
        v_steep = manning_velocity(0.07, r, 0.08)
        assert v_steep > v_gentle


class TestWaveSpeed:
    """Test wave speed estimation."""

    def test_default_multiplier(self):
        """Default 1.5x multiplier."""
        assert wave_speed(4.0) == 6.0

    def test_custom_multiplier(self):
        """Custom multiplier."""
        assert wave_speed(4.0, 1.3) == pytest.approx(5.2)


class TestArrivalTime:
    """Test arrival time calculation."""

    def test_dig_tsho_arrival(self):
        """Arrival at Namche hydropower (11km) should be ~50 minutes."""
        valley = DIG_TSHO["valley"]
        r = hydraulic_radius(valley["channel_width_m"], valley["channel_depth_m"])
        v = manning_velocity(valley["manning_n"], r, valley["slope"])
        ws = wave_speed(v)
        t = arrival_time_minutes(11000, ws)

        targets = DIG_TSHO["validation_targets"]["arrival_time_min"]
        assert targets["min"] <= t <= targets["max"], (
            f"Arrival time {t:.1f} min outside target range "
            f"[{targets['min']}, {targets['max']}]"
        )

    def test_zero_speed(self):
        """Zero wave speed should return infinity (no arrival)."""
        assert arrival_time_minutes(11000, 0) == float("inf")

    def test_proportional_to_distance(self):
        """Double the distance = double the time."""
        t1 = arrival_time_minutes(10000, 5.0)
        t2 = arrival_time_minutes(20000, 5.0)
        assert abs(t2 / t1 - 2.0) < 0.01


class TestAttenuation:
    """Test discharge attenuation over distance."""

    def test_attenuation_at_50km(self):
        """At 50km with 30% decay rate, discharge should be 70% of original."""
        q = attenuate_discharge(1000, 50, 0.30)
        assert abs(q - 700) < 1

    def test_no_attenuation_at_source(self):
        """At distance 0, discharge should be unchanged."""
        q = attenuate_discharge(1000, 0, 0.30)
        assert q == 1000

    def test_decreases_with_distance(self):
        """Discharge should decrease monotonically with distance."""
        q_10 = attenuate_discharge(1000, 10)
        q_30 = attenuate_discharge(1000, 30)
        q_50 = attenuate_discharge(1000, 50)
        assert q_10 > q_30 > q_50


class TestSeverity:
    """Test severity classification."""

    def test_categories(self):
        assert severity_category(10000) == "EXTREME"
        assert severity_category(2000) == "SEVERE"
        assert severity_category(700) == "HIGH"
        assert severity_category(200) == "MODERATE"
        assert severity_category(50) == "LOW"


class TestInputValidation:
    """Test input validation warnings."""

    def test_valid_inputs_no_warnings(self):
        """Reasonable inputs should produce no warnings."""
        warnings = validate_inputs(
            lake_volume_m3=61_700_000,
            valley_slope=0.04,
            channel_width_m=40,
            manning_n=0.07,
        )
        assert len(warnings) == 0

    def test_tiny_volume_warns(self):
        warnings = validate_inputs(1000, 0.04, 40, 0.07)
        assert any("small" in w.lower() for w in warnings)

    def test_huge_volume_warns(self):
        warnings = validate_inputs(100_000_000_000, 0.04, 40, 0.07)
        assert any("large" in w.lower() for w in warnings)

    def test_flat_slope_warns(self):
        warnings = validate_inputs(61_700_000, 0.0001, 40, 0.07)
        assert any("flat" in w.lower() for w in warnings)

    def test_smooth_manning_warns(self):
        warnings = validate_inputs(61_700_000, 0.04, 40, 0.01)
        assert any("smooth" in w.lower() or "low" in w.lower() for w in warnings)


# ── Integration test: full scenario ───────────────────────────────────────────


class TestFullScenario:
    """Test the complete scenario calculation pipeline."""

    def test_dig_tsho_full_scenario(self):
        """Full scenario for Dig Tsho should produce reasonable results."""
        valley = DIG_TSHO["valley"]
        villages = [
            {"name": "Namche Hydropower", "distance_km": 11},
        ]
        result = compute_full_scenario(
            lake_volume_m3=DIG_TSHO["lake"]["volume_m3"],
            valley_slope=valley["slope"],
            channel_width_m=valley["channel_width_m"],
            channel_depth_m=valley["channel_depth_m"],
            manning_n=valley["manning_n"],
            villages=villages,
        )

        # Check velocity is in observed range
        targets = DIG_TSHO["validation_targets"]
        v = result["flow_velocity_mps"]
        assert targets["velocity_mps"]["min"] <= v <= targets["velocity_mps"]["max"]

        # Check arrival time at hydropower plant
        village = result["villages"][0]
        t = village["arrival_time_min"]
        assert targets["arrival_time_min"]["min"] <= t <= targets["arrival_time_min"]["max"]

    def test_imja_full_scenario(self):
        """Full scenario for Imja Lake should produce sensible results."""
        valley = IMJA["valley"]
        result = compute_full_scenario(
            lake_volume_m3=IMJA["lake"]["volume_m3"],
            valley_slope=valley["slope"],
            channel_width_m=valley["channel_width_m"],
            channel_depth_m=valley["channel_depth_m"],
            manning_n=valley["manning_n"],
            villages=IMJA["villages"],
        )

        # Basic sanity checks
        assert result["flow_velocity_mps"] > 0
        assert result["wave_speed_mps"] > result["flow_velocity_mps"]
        assert len(result["villages"]) == 4

        # Villages should be sorted by arrival time
        times = [v["arrival_time_min"] for v in result["villages"]]
        assert times == sorted(times), "Villages not sorted by arrival time"

        # First village (Dingboche, 7km) should arrive in < 60 min
        assert result["villages"][0]["arrival_time_min"] < 60

        # Last village (Lukla, 40km) should arrive later
        assert result["villages"][-1]["arrival_time_min"] > result["villages"][0]["arrival_time_min"]

        # Each village should have a severity category
        for v in result["villages"]:
            assert v["severity"] in ["EXTREME", "SEVERE", "HIGH", "MODERATE", "LOW"]

        # Each village should have an arrival time range
        for v in result["villages"]:
            assert v["arrival_time_low_min"] < v["arrival_time_high_min"]

    def test_villages_preserve_optional_fields(self):
        """Optional fields (elevation, population, name_nepali) should pass through."""
        result = compute_full_scenario(
            lake_volume_m3=61_700_000,
            valley_slope=0.04,
            channel_width_m=40,
            channel_depth_m=5,
            manning_n=0.07,
            villages=IMJA["villages"],
        )
        dingboche = result["villages"][0]
        assert "elevation_m" in dingboche
        assert "population" in dingboche
        assert "name_nepali" in dingboche

    def test_parameters_echoed(self):
        """Input parameters should be included in the result for traceability."""
        result = compute_full_scenario(
            lake_volume_m3=61_700_000,
            valley_slope=0.04,
            channel_width_m=40,
            channel_depth_m=5,
            manning_n=0.07,
            villages=[{"name": "Test", "distance_km": 10}],
        )
        assert result["parameters"]["lake_volume_m3"] == 61_700_000
        assert result["parameters"]["manning_n"] == 0.07


# ── Print a human-readable summary when run directly ──────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("GLOF Validation: Dig Tsho 1985 Event")
    print("=" * 60)

    valley = DIG_TSHO["valley"]
    result = compute_full_scenario(
        lake_volume_m3=DIG_TSHO["lake"]["volume_m3"],
        valley_slope=valley["slope"],
        channel_width_m=valley["channel_width_m"],
        channel_depth_m=valley["channel_depth_m"],
        manning_n=valley["manning_n"],
        villages=[{"name": "Namche Hydropower", "distance_km": 11}],
    )

    print(f"\nPeak discharge (Popov):  {result['discharge']['popov_m3s']:,.0f} m3/s")
    print(f"Peak discharge (Huggel): {result['discharge']['huggel_m3s']:,.0f} m3/s")
    print(f"Flow velocity:           {result['flow_velocity_mps']:.2f} m/s")
    print(f"Wave speed:              {result['wave_speed_mps']:.2f} m/s")
    print(f"\nArrival at Namche Hydropower (11 km):")
    v = result["villages"][0]
    print(f"  Best estimate:  {v['arrival_time_min']:.1f} minutes")
    print(f"  Range:          {v['arrival_time_low_min']:.1f} - {v['arrival_time_high_min']:.1f} minutes")
    print(f"  Observed:       ~50 minutes")
    print(f"  Severity:       {v['severity']}")

    obs = DIG_TSHO["observed"]
    print(f"\nObserved velocity:  {obs['velocity_mps_range']} m/s")
    print(f"Computed velocity:  {result['flow_velocity_mps']:.2f} m/s")

    print("\n" + "=" * 60)
    print("GLOF Demo: Imja Lake Scenario")
    print("=" * 60)

    imja_valley = IMJA["valley"]
    imja_result = compute_full_scenario(
        lake_volume_m3=IMJA["lake"]["volume_m3"],
        valley_slope=imja_valley["slope"],
        channel_width_m=imja_valley["channel_width_m"],
        channel_depth_m=imja_valley["channel_depth_m"],
        manning_n=imja_valley["manning_n"],
        villages=IMJA["villages"],
    )

    print(f"\nPeak discharge: {imja_result['discharge']['average_m3s']:,.0f} m3/s (avg)")
    print(f"Flow velocity:  {imja_result['flow_velocity_mps']:.2f} m/s")
    print(f"Wave speed:     {imja_result['wave_speed_mps']:.2f} m/s")
    print(f"\nDownstream villages (sorted by arrival time):")
    for v in imja_result["villages"]:
        nepali = v.get("name_nepali", "")
        name_str = f"{v['name']} / {nepali}" if nepali else v["name"]
        print(
            f"  {name_str:30s}  {v['arrival_time_min']:6.1f} min  "
            f"({v['arrival_time_low_min']:.0f}-{v['arrival_time_high_min']:.0f} min)  "
            f"[{v['severity']}]"
        )

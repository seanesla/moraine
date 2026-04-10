"""
GLOF (Glacial Lake Outburst Flood) Downstream Arrival Time Calculator
=====================================================================

Core hydrology calculations using published empirical formulas:
- Popov (1991) and Huggel (2002) for peak discharge estimation
- Manning's equation for open channel flow velocity
- Simplified kinematic wave routing for arrival time

All functions are pure math — no AI, no external dependencies.
"""

import math


def peak_discharge_popov(volume_m3: float) -> float:
    """
    Estimate peak discharge using Popov (1991) empirical formula.

    Based on analysis of observed natural dam breaks.

    Args:
        volume_m3: Lake volume in cubic meters.

    Returns:
        Estimated peak discharge in m³/s.
    """
    return 0.0048 * (volume_m3 ** 0.896)


def peak_discharge_huggel(volume_m3: float) -> float:
    """
    Estimate peak discharge using Huggel (2002) empirical formula.

    Derived from glacial lake outburst flood observations.

    Args:
        volume_m3: Lake volume in cubic meters.

    Returns:
        Estimated peak discharge in m³/s.
    """
    return 0.00077 * (volume_m3 ** 1.017)


def peak_discharge_ensemble(volume_m3: float) -> dict:
    """
    Calculate peak discharge using both Popov and Huggel formulas.

    Returns both estimates, their average, and the spread between them.
    This gives a range rather than a single point estimate, which is
    more honest for a life-safety tool.

    Args:
        volume_m3: Lake volume in cubic meters.

    Returns:
        Dict with keys: popov, huggel, average, low, high, spread_percent
    """
    popov = peak_discharge_popov(volume_m3)
    huggel = peak_discharge_huggel(volume_m3)

    low = min(popov, huggel)
    high = max(popov, huggel)
    average = (popov + huggel) / 2
    spread_percent = ((high - low) / average) * 100 if average > 0 else 0

    return {
        "popov_m3s": round(popov, 1),
        "huggel_m3s": round(huggel, 1),
        "average_m3s": round(average, 1),
        "low_m3s": round(low, 1),
        "high_m3s": round(high, 1),
        "spread_percent": round(spread_percent, 1),
    }


def hydraulic_radius(width_m: float, depth_m: float) -> float:
    """
    Calculate hydraulic radius for a rectangular channel cross-section.

    The hydraulic radius measures how efficiently a channel carries water.
    Bigger R = less friction relative to flow area = faster water.

    Formula: R = (width * depth) / (width + 2 * depth)

    Args:
        width_m: Channel width in meters.
        depth_m: Channel depth in meters.

    Returns:
        Hydraulic radius in meters.
    """
    area = width_m * depth_m
    wetted_perimeter = width_m + 2 * depth_m
    return area / wetted_perimeter


def manning_velocity(n: float, hydro_radius: float, slope: float) -> float:
    """
    Calculate flow velocity using Manning's equation for open channel flow.

    Formula: V = (1/n) * R^(2/3) * S^(1/2)

    Where:
        n = Manning's roughness coefficient (dimensionless)
            - Smooth concrete: 0.012
            - Natural river, clear: 0.030-0.035
            - Mountain river with boulders: 0.05-0.10
        R = hydraulic radius in meters
        S = channel slope (dimensionless, e.g., 0.04 = 4% grade)

    Args:
        n: Manning's roughness coefficient.
        hydro_radius: Hydraulic radius in meters.
        slope: Channel slope (rise/run, dimensionless).

    Returns:
        Flow velocity in m/s.
    """
    return (1.0 / n) * (hydro_radius ** (2.0 / 3.0)) * (slope ** 0.5)


def wave_speed(flow_velocity_mps: float, multiplier: float = 1.5) -> float:
    """
    Estimate flood wave front speed from mean flow velocity.

    In dam-break floods, the wave front travels faster than the average
    flow velocity. Empirical observations show the wave front moves at
    roughly 1.5x the mean flow velocity.

    Args:
        flow_velocity_mps: Mean flow velocity in m/s.
        multiplier: Wave speed multiplier (default 1.5, range 1.3-1.7).

    Returns:
        Wave front speed in m/s.
    """
    return flow_velocity_mps * multiplier


def arrival_time_minutes(distance_m: float, wave_speed_mps: float) -> float:
    """
    Calculate how many minutes until the flood wave reaches a point.

    Simple formula: time = distance / speed, converted to minutes.

    Args:
        distance_m: Distance to downstream point in meters.
        wave_speed_mps: Wave front speed in m/s.

    Returns:
        Arrival time in minutes.
    """
    if wave_speed_mps <= 0:
        return float("inf")
    time_seconds = distance_m / wave_speed_mps
    return time_seconds / 60.0


def attenuate_discharge(
    initial_q_m3s: float, distance_km: float, decay_rate_per_50km: float = 0.30
) -> float:
    """
    Estimate how much the peak discharge decreases over distance.

    As a flood wave travels downstream, it spreads out and loses energy
    to friction. Peak discharge drops roughly 20-40% per 50 km.

    Uses exponential decay: Q(d) = Q0 * (1 - rate)^(d / 50)

    Args:
        initial_q_m3s: Peak discharge at the source in m³/s.
        distance_km: Distance downstream in km.
        decay_rate_per_50km: Fraction of peak lost per 50 km (default 0.30).

    Returns:
        Attenuated peak discharge in m³/s at the given distance.
    """
    decay_factor = (1 - decay_rate_per_50km) ** (distance_km / 50.0)
    return initial_q_m3s * decay_factor


def severity_category(discharge_m3s: float) -> str:
    """
    Classify flood severity based on discharge at a point.

    Thresholds based on published GLOF damage reports:
        EXTREME: > 5,000 m³/s — catastrophic destruction
        SEVERE:  > 1,000 m³/s — major structural damage
        HIGH:    > 500 m³/s   — significant flooding
        MODERATE:> 100 m³/s   — minor flooding
        LOW:     ≤ 100 m³/s   — manageable

    Args:
        discharge_m3s: Discharge at the point in m³/s.

    Returns:
        Severity string: EXTREME, SEVERE, HIGH, MODERATE, or LOW.
    """
    if discharge_m3s > 5000:
        return "EXTREME"
    elif discharge_m3s > 1000:
        return "SEVERE"
    elif discharge_m3s > 500:
        return "HIGH"
    elif discharge_m3s > 100:
        return "MODERATE"
    else:
        return "LOW"


def compute_full_scenario(
    lake_volume_m3: float,
    valley_slope: float,
    channel_width_m: float,
    channel_depth_m: float,
    manning_n: float,
    villages: list[dict],
    wave_multiplier: float = 1.5,
    decay_rate: float = 0.30,
) -> dict:
    """
    Run a complete GLOF arrival time calculation for all downstream villages.

    This is the main entry point. It chains together all the physics
    functions and returns a complete scenario result.

    Args:
        lake_volume_m3: Lake volume in cubic meters.
        valley_slope: Average valley slope (dimensionless, e.g., 0.04).
        channel_width_m: River channel width in meters.
        channel_depth_m: Average channel depth in meters.
        manning_n: Manning's roughness coefficient (0.03-0.15).
        villages: List of dicts, each with "name" and "distance_km" keys.
                  Optional keys: "elevation_m", "population", "name_nepali".
        wave_multiplier: Wave speed multiplier (default 1.5).
        decay_rate: Discharge decay rate per 50 km (default 0.30).

    Returns:
        Dict with:
          - discharge: peak discharge estimates (both formulas + range)
          - flow_velocity_mps: mean flow velocity
          - wave_speed_mps: wave front speed
          - hydraulic_radius_m: computed R value
          - villages: list of village results sorted by arrival time, each with:
              name, distance_km, arrival_time_min, arrival_time_range,
              attenuated_discharge_m3s, severity
    """
    # Step 1: Peak discharge from both empirical formulas
    discharge = peak_discharge_ensemble(lake_volume_m3)

    # Step 2: Channel hydraulics
    r = hydraulic_radius(channel_width_m, channel_depth_m)

    # Step 3: Flow velocity via Manning's equation
    velocity = manning_velocity(manning_n, r, valley_slope)

    # Step 4: Wave front speed
    w_speed = wave_speed(velocity, wave_multiplier)

    # Step 5: Calculate arrival time and severity for each village
    village_results = []
    for village in villages:
        distance_km = village["distance_km"]
        distance_m = distance_km * 1000.0

        # Arrival time using the main wave speed estimate
        arrival_min = arrival_time_minutes(distance_m, w_speed)

        # Arrival time range: use velocity (slower) and 1.7x velocity (faster)
        speed_slow = wave_speed(velocity, 1.3)
        speed_fast = wave_speed(velocity, 1.7)
        arrival_slow = arrival_time_minutes(distance_m, speed_slow)
        arrival_fast = arrival_time_minutes(distance_m, speed_fast)

        # Attenuated discharge at this distance (using average of both formulas)
        atten_q = attenuate_discharge(discharge["average_m3s"], distance_km, decay_rate)

        result = {
            "name": village["name"],
            "distance_km": distance_km,
            "arrival_time_min": round(arrival_min, 1),
            "arrival_time_low_min": round(arrival_fast, 1),  # faster wave = shorter time
            "arrival_time_high_min": round(arrival_slow, 1),  # slower wave = longer time
            "attenuated_discharge_m3s": round(atten_q, 1),
            "severity": severity_category(atten_q),
        }

        # Pass through optional fields
        if "elevation_m" in village:
            result["elevation_m"] = village["elevation_m"]
        if "population" in village:
            result["population"] = village["population"]
        if "name_nepali" in village:
            result["name_nepali"] = village["name_nepali"]

        village_results.append(result)

    # Sort by arrival time (closest first)
    village_results.sort(key=lambda v: v["arrival_time_min"])

    return {
        "discharge": discharge,
        "hydraulic_radius_m": round(r, 3),
        "flow_velocity_mps": round(velocity, 2),
        "wave_speed_mps": round(w_speed, 2),
        "parameters": {
            "lake_volume_m3": lake_volume_m3,
            "valley_slope": valley_slope,
            "channel_width_m": channel_width_m,
            "channel_depth_m": channel_depth_m,
            "manning_n": manning_n,
            "wave_multiplier": wave_multiplier,
            "decay_rate_per_50km": decay_rate,
        },
        "villages": village_results,
    }


def validate_inputs(
    lake_volume_m3: float,
    valley_slope: float,
    channel_width_m: float,
    manning_n: float,
    channel_depth_m: float = None,
) -> list[str]:
    """
    Check if user-provided parameters are physically reasonable.

    Returns a list of warning messages. Empty list = all inputs OK.

    Args:
        lake_volume_m3: Lake volume in cubic meters.
        valley_slope: Valley slope (dimensionless).
        channel_width_m: Channel width in meters.
        manning_n: Manning's roughness coefficient.
        channel_depth_m: Channel depth in meters (optional).

    Returns:
        List of warning strings. Empty if all inputs are reasonable.
    """
    warnings = []

    if lake_volume_m3 < 100_000:
        warnings.append(
            f"Lake volume ({lake_volume_m3:,.0f} m³) is very small for a GLOF. "
            "Most dangerous glacial lakes are >1 million m³."
        )
    elif lake_volume_m3 > 10_000_000_000:
        warnings.append(
            f"Lake volume ({lake_volume_m3:,.0f} m³) is extremely large. "
            "The largest glacial lakes are ~200 million m³. Check your units."
        )

    if valley_slope < 0.001:
        warnings.append(
            f"Valley slope ({valley_slope}) is nearly flat. "
            "Mountain valleys typically have slopes of 0.02-0.10."
        )
    elif valley_slope > 0.20:
        warnings.append(
            f"Valley slope ({valley_slope}) is extremely steep (>{20}%). "
            "This may indicate a cliff or waterfall rather than a valley."
        )

    if manning_n < 0.03:
        warnings.append(
            f"Manning's n ({manning_n}) is very low — that's smoother than a "
            "natural river. Mountain rivers are typically 0.05-0.08."
        )
    elif manning_n > 0.15:
        warnings.append(
            f"Manning's n ({manning_n}) is very high — that's extremely rough. "
            "Even boulder-strewn mountain rivers are typically <0.10."
        )

    if channel_width_m < 1:
        warnings.append(
            f"Channel width ({channel_width_m} m) is unrealistically narrow."
        )
    elif channel_width_m > 500:
        warnings.append(
            f"Channel width ({channel_width_m} m) is very wide for a mountain river. "
            "Himalayan rivers near glacial lakes are typically 20-100 m."
        )

    if channel_depth_m is not None:
        if channel_depth_m < 0.5:
            warnings.append(
                f"Channel depth ({channel_depth_m} m) is very shallow."
            )
        elif channel_depth_m > 30:
            warnings.append(
                f"Channel depth ({channel_depth_m} m) seems too deep for a mountain river."
            )

    return warnings

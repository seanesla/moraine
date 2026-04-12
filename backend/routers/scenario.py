from fastapi import APIRouter

from backend.schemas import ScenarioRequest, ScenarioResponse

router = APIRouter(prefix="/api", tags=["scenario"])


@router.post("/scenario", response_model=ScenarioResponse)
def run_scenario(req: ScenarioRequest):
    """Run a full GLOF scenario calculation."""
    import glof_core

    villages = [v.model_dump(exclude_none=True) for v in req.villages]

    result = glof_core.compute_full_scenario(
        lake_volume_m3=req.lake_volume_m3,
        valley_slope=req.valley_slope,
        channel_width_m=req.channel_width_m,
        channel_depth_m=req.channel_depth_m,
        manning_n=req.manning_n,
        villages=villages,
        wave_multiplier=req.wave_multiplier,
        decay_rate=req.decay_rate,
    )

    return result

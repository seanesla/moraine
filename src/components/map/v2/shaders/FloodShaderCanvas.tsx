import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useMap } from "react-leaflet";
import { Renderer, Program, Mesh, Geometry, Vec2, Vec3 } from "ogl";
import vertSrc from "./floodWave.vert.glsl?raw";
import fragSrc from "./floodWave.frag.glsl?raw";
import { quadraticBezierPoints, type LatLon } from "../lib/curves";
import { latLngToScreen } from "../lib/projection";

export interface FloodShaderHandle {
  /** Drive front position along the path. 0 = lake, 1 = farthest village. */
  setProgress(p: number): void;
  /** Wave front brightness (0 = invisible, 1 = full). */
  setIntensity(i: number): void;
  /** Pop the radial breach burst at the lake. Decays automatically. */
  triggerBreach(): void;
  /** Fire an impact ripple at a specific lat/lon. */
  triggerImpactAt(latLng: LatLon): void;
}

interface FloodShaderCanvasProps {
  lakeLatLng: LatLon;
  farthestLatLng: LatLon;
  /** Bezier curvature + side used for RiverPaths; shader samples the same curve. */
  curvature: number;
  side: -1 | 1;
  /** distance_km of the farthest village — drives the attenuation curve. */
  maxDistanceKm: number;
}

const BEZIER_STEPS = 64;
const IMPACT_SLOTS = 8;
const DECAY_RATE_PER_50KM = 0.3; // matches glof_core.attenuate_discharge default

/**
 * Phase 4: imperative shader canvas. The GSAP master timeline in
 * useFloodChoreography drives progress / intensity / breach / impact via the
 * ref; this component just renders per frame and decays transient uniforms.
 *
 * Coordinate sync + WebGL context cleanup unchanged from Phase 2/3.
 */
const FloodShaderCanvas = forwardRef<FloodShaderHandle, FloodShaderCanvasProps>(
  function FloodShaderCanvas(
    {
      lakeLatLng,
      farthestLatLng,
      curvature,
      side,
      maxDistanceKm,
    },
    ref,
  ) {
    const map = useMap();

    // Expose these refs to the imperative handle. Each ref is a plain
    // function that the GSAP timeline calls from onUpdate / tl.call. We
    // install them in the RAF-driven useEffect below, which owns the
    // shader program.
    const apiRef = useRef<FloodShaderHandle | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        setProgress(p: number) {
          apiRef.current?.setProgress(p);
        },
        setIntensity(i: number) {
          apiRef.current?.setIntensity(i);
        },
        triggerBreach() {
          apiRef.current?.triggerBreach();
        },
        triggerImpactAt(latLng: LatLon) {
          apiRef.current?.triggerImpactAt(latLng);
        },
      }),
      [],
    );

    const maxDistanceKmRef = useRef(maxDistanceKm);
    useEffect(() => {
      maxDistanceKmRef.current = maxDistanceKm;
    }, [maxDistanceKm]);

    useEffect(() => {
      const container = map.getContainer();
      if (!container) return;

      const canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "450";
      container.appendChild(canvas);

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const renderer = new Renderer({ canvas, dpr, alpha: true });
      const gl = renderer.gl;
      gl.clearColor(0, 0, 0, 0);

      const geometry = new Geometry(gl, {
        position: {
          size: 2,
          data: new Float32Array([-1, -1, 3, -1, -1, 3]),
        },
        uv: {
          size: 2,
          data: new Float32Array([0, 0, 2, 0, 0, 2]),
        },
      });

      // Impact flash ring buffer. Each slot is a Vec3 (x, y, startTime). A
      // startTime < 0 means the slot is inactive. We keep a single array
      // instance and rewrite it in place so the uniform reference is stable.
      const impactFlash: Vec3[] = Array.from(
        { length: IMPACT_SLOTS },
        () => new Vec3(0, 0, -1),
      );

      const program = new Program(gl, {
        vertex: vertSrc,
        fragment: fragSrc,
        transparent: true,
        uniforms: {
          uResolution: { value: new Vec2(1, 1) },
          uFrontPosScreen: { value: new Vec2(0, 0) },
          uLakePosScreen: { value: new Vec2(0, 0) },
          uTravelDirScreen: { value: new Vec2(1, 0) },
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uIntensity: { value: 0 },
          uDischargeAtFront: { value: 1 },
          uUncertaintyRadius: { value: 8 * dpr },
          uBreachFlash: { value: 0 },
          uImpactFlash: { value: impactFlash },
        },
      });

      const mesh = new Mesh(gl, { geometry, program });

      const pathPoints: LatLon[] = quadraticBezierPoints(
        lakeLatLng,
        farthestLatLng,
        curvature,
        side,
        BEZIER_STEPS,
      );

      const resize = () => {
        const size = map.getSize();
        const w = size.x;
        const h = size.y;
        renderer.setSize(w, h);
        program.uniforms.uResolution.value.set(w * dpr, h * dpr);
      };

      const updateTravelDir = () => {
        const [lx, ly] = latLngToScreen(map, lakeLatLng);
        const [fx, fy] = latLngToScreen(map, farthestLatLng);
        const dx = (fx - lx) * dpr;
        const dy = (fy - ly) * dpr;
        const len = Math.hypot(dx, dy) || 1;
        program.uniforms.uTravelDirScreen.value.set(dx / len, dy / len);
      };

      const curveLatLngAt = (t: number): LatLon => {
        const clamped = Math.max(0, Math.min(1, t));
        const idx = clamped * (pathPoints.length - 1);
        const lo = Math.floor(idx);
        const hi = Math.min(pathPoints.length - 1, lo + 1);
        const f = idx - lo;
        const [la0, lo0] = pathPoints[lo];
        const [la1, lo1] = pathPoints[hi];
        return [la0 + (la1 - la0) * f, lo0 + (lo1 - lo0) * f];
      };

      // Progress state (owned by the shader effect, driven by setProgress).
      let progress = 0;

      const updateFront = () => {
        const latLon = curveLatLngAt(progress);
        const [fx, fy] = latLngToScreen(map, latLon);
        program.uniforms.uFrontPosScreen.value.set(fx * dpr, fy * dpr);
      };

      const syncPositions = () => {
        const [lx, ly] = latLngToScreen(map, lakeLatLng);
        program.uniforms.uLakePosScreen.value.set(lx * dpr, ly * dpr);
        updateTravelDir();
        updateFront();
      };

      map.on("move", syncPositions);
      map.on("zoom", syncPositions);
      map.on("viewreset", syncPositions);
      map.on("zoomend", syncPositions);
      map.on("moveend", syncPositions);
      map.on("resize", resize);

      resize();
      syncPositions();

      // Next free impact slot — overwrite oldest if all 8 are busy.
      let nextImpactSlot = 0;
      const fireImpactAt = (px: number, py: number, timeSec: number) => {
        const slot = impactFlash[nextImpactSlot % IMPACT_SLOTS];
        slot[0] = px;
        slot[1] = py;
        slot[2] = timeSec;
        nextImpactSlot += 1;
      };

      const start = performance.now();
      let frame = 0;

      // Install the imperative API now that the program exists.
      apiRef.current = {
        setProgress(p: number) {
          const t = Math.max(0, Math.min(1, p));
          progress = t;
          program.uniforms.uProgress.value = t;

          // Attenuation curve matches glof_core.attenuate_discharge exactly:
          // decay_factor = (1 - decay_rate_per_50km) ^ (dist_km / 50)
          const distKm = t * maxDistanceKmRef.current;
          program.uniforms.uDischargeAtFront.value = Math.pow(
            1 - DECAY_RATE_PER_50KM,
            distKm / 50,
          );

          // Uncertainty radius widens as the wave travels downstream.
          const minR = 10 * dpr;
          const maxR = 72 * dpr;
          program.uniforms.uUncertaintyRadius.value = minR + (maxR - minR) * t;

          updateFront();
        },
        setIntensity(i: number) {
          program.uniforms.uIntensity.value = Math.max(0, Math.min(1, i));
        },
        triggerBreach() {
          program.uniforms.uBreachFlash.value = 1.0;
        },
        triggerImpactAt(latLng: LatLon) {
          const [px, py] = latLngToScreen(map, latLng);
          const tSec = (performance.now() - start) / 1000;
          fireImpactAt(px * dpr, py * dpr, tSec);
        },
      };

      const loop = () => {
        const now = performance.now();
        const tSec = (now - start) / 1000;
        program.uniforms.uTime.value = tSec;

        // Breach flash decays every frame regardless of play state (the
        // fragment shader treats 0 as no burst). Same decay constant as
        // Phase 3: ~0.92/frame → clears in ~0.8s at 60fps.
        const breach = program.uniforms.uBreachFlash.value as number;
        program.uniforms.uBreachFlash.value = breach * 0.92;

        renderer.render({ scene: mesh });
        frame = requestAnimationFrame(loop);
      };

      loop();

      return () => {
        cancelAnimationFrame(frame);
        apiRef.current = null;
        map.off("move", syncPositions);
        map.off("zoom", syncPositions);
        map.off("viewreset", syncPositions);
        map.off("zoomend", syncPositions);
        map.off("moveend", syncPositions);
        map.off("resize", resize);
        if (canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
        try {
          program.remove();
        } catch {
          /* already gone */
        }
        try {
          geometry.remove();
        } catch {
          /* already gone */
        }
        const loseExt = gl.getExtension("WEBGL_lose_context");
        loseExt?.loseContext();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      map,
      lakeLatLng[0],
      lakeLatLng[1],
      farthestLatLng[0],
      farthestLatLng[1],
      curvature,
      side,
    ]);

    return null;
  },
);

export default FloodShaderCanvas;

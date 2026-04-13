#ifdef GL_ES
precision mediump float;
#endif

varying vec2 vUv;

uniform vec2 uResolution;        // device px (width, height)
uniform vec2 uFrontPosScreen;    // device px, top-left origin
uniform vec2 uLakePosScreen;     // device px, top-left origin
uniform vec2 uTravelDirScreen;   // unit vector lake -> farthest, screen space
uniform float uTime;
uniform float uProgress;
uniform float uIntensity;
uniform float uDischargeAtFront; // 0..1, attenuation curve output
uniform float uUncertaintyRadius; // device px
uniform float uBreachFlash;      // 0..1, decays in JS each frame
uniform vec3 uImpactFlash[8];    // (x, y, startTime). z<0 = inactive

// Cheap 2D value-noise style hash. Returns 0..1.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // gl_FragCoord.y is bottom-up in WebGL; Leaflet's container points are
  // top-down. Flip once so the rest of the shader reads top-left origin.
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

  // --- Stage A: distance fields relative to the wave front ---
  vec2 toFront = frag - uFrontPosScreen;
  float distFront = length(toFront);
  float alongAxis = dot(toFront, uTravelDirScreen); // negative = behind
  vec2 sideVec = toFront - alongAxis * uTravelDirScreen;
  float sideDist = length(sideVec);

  // --- Stage B: white-hot crescent front ---
  // Tight gaussian. Squared radius picks the falloff width.
  float core = exp(-(distFront * distFront) / 600.0) * uIntensity;

  // --- Stage C: trail body (only behind the front, inside the width tube) ---
  // Behind = alongAxis <= 0. Tube width ~140 px falls off smoothly.
  float behindMask = step(alongAxis, 0.0);
  float tube = smoothstep(140.0, 0.0, sideDist);
  float axialDecay = exp(alongAxis / 90.0); // alongAxis negative => decaying back
  float body = axialDecay * tube * behindMask * uIntensity * uDischargeAtFront;

  // --- Stage D: spray noise on leading edge ---
  float n = hash(floor(frag * 0.35 + vec2(uTime * 3.0)));
  float spray = smoothstep(0.35, 1.0, core) * n * 0.7;

  // --- Stage E: uncertainty haze (soft cyan cloud widening with distance) ---
  float hazeSigma = max(uUncertaintyRadius, 1.0);
  float haze = exp(-(distFront * distFront) / (hazeSigma * hazeSigma)) * 0.3 * uIntensity;

  // --- Stage F: breach burst at the lake ---
  float dLake = distance(frag, uLakePosScreen);
  float burst = exp(-(dLake * dLake) / 4500.0) * uBreachFlash;

  // --- Stage G: village impact ripples ---
  // Branchless accumulation so WebGL 1 drivers with strict loop constraints
  // don't choke on `continue`.
  float ripples = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 imp = uImpactFlash[i];
    float age = uTime - imp.z;
    float active = step(0.0, imp.z) * step(0.0, age) * step(age, 0.6);
    float radius = age * 220.0;
    float dImp = distance(frag, imp.xy);
    float ringBand = smoothstep(8.0, 0.0, abs(dImp - radius));
    float fade = 1.0 - (age / 0.6);
    ripples += ringBand * fade * active;
  }

  // --- Stage H: compose ---
  vec3 white = vec3(1.0, 0.98, 0.92);
  vec3 orange = vec3(1.0, 0.55, 0.15);
  vec3 deepOrange = vec3(0.9, 0.32, 0.08);
  vec3 cyan = vec3(0.2, 0.9, 1.0);

  vec3 color =
      mix(orange, white, clamp(core, 0.0, 1.0))
    + body * deepOrange
    + spray * white
    + haze * cyan * 0.7
    + burst * white
    + ripples * cyan * 1.4;

  float alpha = clamp(
    core + body * 0.8 + haze * 0.4 + burst + ripples * 0.9,
    0.0,
    1.0
  );

  gl_FragColor = vec4(color, alpha);
}

#ifdef GL_ES
precision mediump float;
#endif

varying vec2 vUv;

uniform vec2 uResolution;        // device px (width, height)
uniform vec2 uFrontPosScreen;    // device px, top-left origin
uniform vec2 uLakePosScreen;     // device px, top-left origin
uniform vec2 uTravelDirScreen;   // unit vector lake -> farthest, screen space (unused)
uniform float uTime;
uniform float uProgress;
uniform float uIntensity;
uniform float uDischargeAtFront; // 0..1, attenuation curve output (unused)
uniform float uUncertaintyRadius; // device px (unused)
uniform float uBreachFlash;      // 0..1, decays in JS each frame
uniform vec3 uImpactFlash[8];    // (x, y, startTime). z<0 = inactive

void main() {
  // gl_FragCoord.y is bottom-up in WebGL; Leaflet's container points are
  // top-down. Flip once so the rest of the shader reads top-left origin.
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

  // --- Wave front: a small radially symmetric glow that rides the
  //     bezier curve (position driven by uFrontPosScreen).
  float distFront = distance(frag, uFrontPosScreen);
  float core = exp(-(distFront * distFront) / 900.0) * uIntensity;
  float halo = exp(-(distFront * distFront) / 6000.0) * 0.35 * uIntensity;

  // --- Breach burst at the lake (decays in JS) ---
  float dLake = distance(frag, uLakePosScreen);
  float burst = exp(-(dLake * dLake) / 4500.0) * uBreachFlash;

  // --- Village impact ripples (expanding rings) ---
  float ripples = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 imp = uImpactFlash[i];
    float age = uTime - imp.z;
    float active = step(0.0, imp.z) * step(0.0, age) * step(age, 0.7);
    float radius = age * 200.0;
    float dImp = distance(frag, imp.xy);
    float ringBand = smoothstep(6.0, 0.0, abs(dImp - radius));
    float fade = 1.0 - (age / 0.7);
    ripples += ringBand * fade * active;
  }

  // --- Compose (water palette, no trailing body) ---
  vec3 foam = vec3(0.92, 0.98, 1.0);
  vec3 surge = vec3(0.32, 0.78, 1.0);
  vec3 mist = vec3(0.2, 0.9, 1.0);

  vec3 color =
      mix(surge, foam, clamp(core, 0.0, 1.0))
    + halo * surge
    + burst * foam
    + ripples * mist * 1.4;

  float alpha = clamp(
    core + halo * 0.8 + burst + ripples * 0.9,
    0.0,
    1.0
  );

  gl_FragColor = vec4(color, alpha);
}

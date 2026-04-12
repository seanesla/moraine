import React from "react";
import ReactDOM from "react-dom/client";
// @ts-expect-error font package has no types
import "@fontsource-variable/space-grotesk";
// @ts-expect-error font package has no types
import "@fontsource-variable/manrope";
import App from "./App";
import "./styles/globals.css";
import "./lib/gsap-setup";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

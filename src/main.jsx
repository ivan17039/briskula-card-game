import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { init } from "@plausible-analytics/tracker";
import "./index.css";
import App from "./App.jsx";

// Initialize Plausible Analytics
init({
  domain: "briskula-treseta.games",
  autoCapturePageviews: true,
  hashBasedRouting: true, // Since you're using hash-based routing
  captureOnLocalhost: false, // Don't track on localhost
  logging: false, // Disable console logs in production
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

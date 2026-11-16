import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { OverlayApp } from "./overlay/OverlayApp";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/jetbrains-mono";
import "./styles/globals.css";

// West Overlay ayrı bir pencerede aynı uygulamayı #/overlay ile açar; launcher kabuğu yüklenmez
const isOverlay = location.hash.startsWith("#/overlay");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isOverlay ? (
      <OverlayApp />
    ) : (
      <HashRouter>
        <App />
      </HashRouter>
    )}
  </React.StrictMode>,
);

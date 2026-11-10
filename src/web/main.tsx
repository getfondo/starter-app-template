import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { initAuth } from "./lib/auth";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
initAuth()
  .then(() => {
    root.render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    root.render(<p className="error">Sign in is not available right now. {err instanceof Error ? err.message : ""}</p>);
  });

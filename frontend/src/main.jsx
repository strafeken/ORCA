import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { fetchCsrfToken } from "./auth/api";
import App from "./App.jsx";
import "./styles/orca.css";

try {
  await fetchCsrfToken();
} catch (error) {
  console.warn("CSRF token initialization failed; mounting app in restricted state.", error);
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

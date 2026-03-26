import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";

// --- DEBUG START ---
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("%c SUPABASE DEBUG ", "background: red; color: white; font-weight: bold;");
console.log("URL:", url ? url : "MISSING ❌");
console.log("KEY:", key ? "EXISTS ✅" : "MISSING ❌");

if (!url || !key) {
  console.error("CRITICAL: Environment variables are missing!");
}
// --- DEBUG END ---

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
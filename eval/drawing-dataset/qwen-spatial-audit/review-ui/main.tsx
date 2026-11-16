import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/index.css";
import { QwenReviewPage } from "./QwenReviewPage";

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <QwenReviewPage />
  </MemoryRouter>,
);

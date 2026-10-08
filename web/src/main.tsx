import { StrictMode, useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { pageHash, resolvePage } from "./api";
import "./styles.css";

const AdminPage = lazy(() => import("./admin/AdminPage"));
const WorkspacePage = lazy(() => import("./workspace/WorkspacePage"));

declare global {
  interface Window {
    __PAGE__?: "admin" | "workspace";
  }
}

type PageState = "loading" | "admin" | "workspace" | "notfound";

function App() {
  const [page, setPage] = useState<PageState>(window.__PAGE__ ?? "loading");

  useEffect(() => {
    if (page !== "loading") return;
    if (!pageHash) return setPage("notfound");
    resolvePage(pageHash)
      .then((r) => setPage(r.page))
      .catch(() => setPage("notfound"));
  }, [page]);

  if (page === "loading") return <div className="center-message">Loading…</div>;
  if (page === "notfound") return <div className="center-message">Nothing here.</div>;
  return (
    <Suspense fallback={<div className="center-message">Loading…</div>}>
      {page === "admin" ? <AdminPage adminHash={pageHash} /> : <WorkspacePage hash={pageHash} />}
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

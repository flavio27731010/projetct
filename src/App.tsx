import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabase";
import Login from "./pages/Login";
import Home from "./pages/Home";
import NewReport from "./pages/NewReport";
import ReportDetail from "./pages/ReportDetail";

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (!sess) nav("/login");
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="container">Carregando...</div>;

  const authed = !!session;

  return (
    <>
      <div
        className="container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {/* ✅ botão pequeno de início */}
        <Link
  to="/"
  title="Início"
  style={{
    width: 38,
    height: 38,
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
    transition: "all 0.18s ease",
    textDecoration: "none",
  }}
  onMouseEnter={(e) => {
    (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-1px)";
    (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 10px 22px rgba(0,0,0,0.20)";
    (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.22)";
  }}
  onMouseLeave={(e) => {
    (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0px)";
    (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 6px 18px rgba(0,0,0,0.15)";
    (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.10)";
  }}
>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 10.5L12 3l9 7.5" />
    <path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
    <path d="M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6" />
  </svg>
</Link>



        {authed && (
          <button
            className="btn secondary"
            style={{
              padding: "6px 10px",
              fontSize: 13,
              borderRadius: 10,
              height: "auto",
            }}
            onClick={async () => {
              await supabase.auth.signOut();
              nav("/login");
            }}
          >
            Sair
          </button>
        )}
      </div>

      <Routes>
        <Route path="/login" element={!authed ? <Login /> : <Navigate to="/" />} />
        <Route path="/" element={authed ? <Home /> : <Navigate to="/login" />} />
        <Route path="/new" element={authed ? <NewReport /> : <Navigate to="/login" />} />
        <Route path="/report/:id" element={authed ? <ReportDetail /> : <Navigate to="/login" />} />
      </Routes>
    </>
  );
}

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
      <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link to="/" className="badge">🏠 Ínicio</Link>
        {authed && (
          <button
            className="btn secondary"
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

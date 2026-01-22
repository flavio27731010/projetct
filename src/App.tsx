import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { db } from "./lib/db";
import { syncNow } from "./lib/sync";
import { registerSW } from "virtual:pwa-register";
import { forceUpdateApp } from "./lib/forceUpdate";
import Login from "./pages/Login";
import Home from "./pages/Home";
import NewReport from "./pages/NewReport";
import ReportDetail from "./pages/ReportDetail";

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ✅ PWA update banner
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateFn, setUpdateFn] = useState<null | ((reloadPage?: boolean) => Promise<void>)>(null);

  // ✅ NOVO: email do usuário logado
  const [userEmail, setUserEmail] = useState<string>("");

  const nav = useNavigate();

  // ✅ Sync global (botão disponível em todas as páginas logadas)
  const [syncState, setSyncState] = useState<"OK" | "PENDING" | "OFFLINE">("OK");
  const [syncMsg, setSyncMsg] = useState<string>("");

  async function refreshSyncState() {
    try {
      const queue = await db.syncQueue.count();
      if (!navigator.onLine) setSyncState("OFFLINE");
      else if (queue > 0) setSyncState("PENDING");
      else setSyncState("OK");
    } catch {
      // noop
    }
  }

  async function syncNowManual() {
    setSyncMsg("");
    try {
      await syncNow();
      setSyncMsg("✅ Sync concluído!");
    } catch (err) {
      console.error(err);
      setSyncMsg("❌ Falha ao sincronizar.");
    }
    refreshSyncState();
  }

  async function clearPwaCaches() {
    // ⚠️ limpa SOMENTE caches do navegador (não mexe no IndexedDB/Dexie)
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      console.warn("Falha ao limpar caches:", e);
    }
  }

  async function applyUpdate() {
    if (!updateFn) {
      // fallback
      await clearPwaCaches();
      window.location.reload();
      return;
    }

    setUpdating(true);
    try {
      // 1) limpa caches antigos (resolve casos em que fica preso em assets antigos)
      await clearPwaCaches();
      // 2) ativa o SW novo e recarrega
      await updateFn(true);
    } catch (e) {
      console.error("Falha ao aplicar update PWA:", e);
      window.location.reload();
    } finally {
      setUpdating(false);
    }
  }

  useEffect(() => {
  forceUpdateApp();
}, []);

  useEffect(() => {
    // ✅ Força limpeza de cache (resolve casos em que o usuário fica preso em JS/CSS antigos)
    // - Só roda quando estiver ONLINE
    // - Só roda 1 vez por sessão (evita loop de reload)
    const HARD_KEY = "__HARD_CACHE_CLEARED__";
    if (navigator.onLine && !sessionStorage.getItem(HARD_KEY)) {
      sessionStorage.setItem(HARD_KEY, "1");
      clearPwaCaches().finally(() => {
        window.location.reload();
      });
      return;
    }

    // ✅ registra SW e detecta quando existe nova versão
    const updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdateAvailable(true);
      },
      onOfflineReady() {
        // opcional: pode mostrar toast "pronto para uso offline"
      },
    });

    setUpdateFn(() => updateServiceWorker);

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);

      // ✅ NOVO: pega o email ao iniciar
      setUserEmail(data.session?.user?.email ?? "");

      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);

      // ✅ NOVO: atualiza email sempre que mudar auth
      setUserEmail(sess?.user?.email ?? "");

      if (!sess) nav("/login");
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // ✅ atualiza badge de sync periodicamente (leve)
  useEffect(() => {
    if (!session) return;
    refreshSyncState();
    const interval = setInterval(refreshSyncState, 1500);
    return () => clearInterval(interval);
  }, [session]);

  if (loading) return <div className="container">Carregando...</div>;

  const authed = !!session;

  return (
    <>
      {updateAvailable && (
        <div
          className="card"
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            maxWidth: 560,
            width: "calc(100% - 24px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <strong>🚀 Nova versão disponível</strong>
              <div className="muted">
                Toque em “Atualizar” para carregar a versão mais recente.
              </div>
            </div>
            <button className="btn" onClick={applyUpdate} disabled={updating}>
              {updating ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>
      )}

      <div
        className="container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "nowrap",
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
            (e.currentTarget as HTMLAnchorElement).style.transform =
              "translateY(-1px)";
            (e.currentTarget as HTMLAnchorElement).style.boxShadow =
              "0 10px 22px rgba(0,0,0,0.20)";
            (e.currentTarget as HTMLAnchorElement).style.borderColor =
              "rgba(255,255,255,0.22)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.transform =
              "translateY(0px)";
            (e.currentTarget as HTMLAnchorElement).style.boxShadow =
              "0 6px 18px rgba(0,0,0,0.15)";
            (e.currentTarget as HTMLAnchorElement).style.borderColor =
              "rgba(255,255,255,0.10)";
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* ✅ Sync (igual ao da Home) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
  className="badge"
  title={syncMsg || ""}
  style={{
    fontSize: 11,
    padding: "4px 8px",
    lineHeight: "14px",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  }}
>
  <span
    style={{
      width: 8,
      height: 8,
      borderRadius: 999,
      display: "inline-block",
      background:
        syncState === "OFFLINE"
          ? "#ef4444"
          : syncState === "PENDING"
          ? "#f59e0b"
          : "#22c55e",
    }}
  />
  {syncState === "OFFLINE" ? "Offline" : syncState === "PENDING" ? "Pendente" : "Sync OK"}
</span>


              <button
                className="btn secondary"
                title="Sincronizar agora"
                onClick={syncNowManual}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
                  transition: "all 0.18s ease",
                }}
              >
                🔄
              </button>
            </div>

            {/* ✅ NOVO: badge do email */}
            {userEmail && (
              <div
                style={{
                  padding: "6px 12px",
                  borderRadius: 14,
                  background: "rgba(31, 31, 31, 0.24)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  fontSize: 13,
                  color: "rgba(255,255,255,0.85)",
                  maxWidth: 240,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={userEmail}
              >
                👤 <strong>{userEmail}</strong>
              </div>
            )}

            {/* ✅ botão sair (igual ao seu) */}
         <button
  className="btn secondary"
  title="Sair"
  style={{
    width: 38,
    height: 38,
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
    transition: "all 0.18s ease",
    whiteSpace: "nowrap",
  }}
  onClick={async () => {
    await supabase.auth.signOut();
    nav("/login");
  }}
>
  ⏻
</button>

          </div>
        )}
      </div>

      <Routes>
        <Route
          path="/login"
          element={!authed ? <Login /> : <Navigate to="/" />}
        />
        <Route
          path="/"
          element={authed ? <Home /> : <Navigate to="/login" />}
        />
        <Route
          path="/new"
          element={authed ? <NewReport /> : <Navigate to="/login" />}
        />
        <Route
          path="/report/:id"
          element={authed ? <ReportDetail /> : <Navigate to="/login" />}
        />
      </Routes>
    </>
  );
}

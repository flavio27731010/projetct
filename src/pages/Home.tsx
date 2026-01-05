import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../lib/db";
import type { Pending, Report } from "../lib/db";
import { formatDateBR, nowISO, uuid } from "../lib/utils";
import { supabase } from "../lib/supabase";
import { syncNow } from "../lib/sync";

export default function Home() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ✅ Busca
  const [query, setQuery] = useState("");

  // ✅ contagem pendências abertas por report
  const [openCountMap, setOpenCountMap] = useState<Record<string, number>>({});

  // ✅ indicador de sync
  const [syncState, setSyncState] = useState<"OK" | "PENDING" | "OFFLINE">("OK");
  const [syncMsg, setSyncMsg] = useState<string>("");

  // ✅ desfazer exclusão
  const [undoData, setUndoData] = useState<{
    reports: Report[];
    pendings: Pending[];
    activities: any[];
    queueItems: any[];
    timeoutId: any;
  } | null>(null);

  // 🔒 senha simples para exclusão
  const DELETE_PASSWORD = "Fs277310@";

  async function load() {
    const list = await db.reports.orderBy("updatedAt").reverse().toArray();
    setReports(list);

    // ✅ pendências abertas por relatório (rápido e útil)
    const allPendings = await db.pendings.toArray();
    const map: Record<string, number> = {};
    for (const p of allPendings) {
      if (p.status !== "RESOLVIDO") {
        map[p.reportId] = (map[p.reportId] ?? 0) + 1;
      }
    }
    setOpenCountMap(map);

    // ✅ status do sync
    const queue = await db.syncQueue.count();
    if (!navigator.onLine) setSyncState("OFFLINE");
    else if (queue > 0) setSyncState("PENDING");
    else setSyncState("OK");
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 1500);
    return () => clearInterval(interval);
  }, []);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function enterDeleteMode() {
    const pass = prompt("🔒 Digite a senha para excluir relatórios:");
    if (!pass) return;

    if (pass !== DELETE_PASSWORD) {
      alert("❌ Senha incorreta.");
      return;
    }

    setSelectMode(true);
    setSelectedIds(new Set());
  }

  function cancelDeleteMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // ✅ filtro do histórico
  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;

    return reports.filter((r) => {
      const txt = `${r.shiftLetter} ${r.shift} ${r.date} ${formatDateBR(r.date)} ${r.signatureName} ${r.status}`.toLowerCase();
      return txt.includes(q);
    });
  }, [query, reports]);

  // ✅ selecionar todos os relatórios visíveis (respeita a busca)
  function selectAllVisible() {
    const ids = filteredReports.map((r) => r.id);
    setSelectedIds(new Set(ids));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const allVisibleSelected =
    filteredReports.length > 0 &&
    filteredReports.every((r) => selectedIds.has(r.id));

  async function deleteSelected() {
    if (selectedIds.size === 0) {
      alert("Selecione pelo menos 1 relatório para excluir.");
      return;
    }

    const ok = confirm(`⚠️ Você irá excluir ${selectedIds.size} relatório(s). Deseja continuar?`);
    if (!ok) return;

    const ids = Array.from(selectedIds);

    try {
      // ✅ captura dados para UNDO
      const reportsToDelete = (await db.reports.bulkGet(ids)).filter(Boolean) as Report[];
      const activitiesToDelete = await db.activities.where("reportId").anyOf(ids).toArray();
      const pendingsToDelete = await db.pendings.where("reportId").anyOf(ids).toArray();

      const t = nowISO();
      const queueItems = ids.map((reportId) => ({
        id: uuid(),
        type: "DELETE_REPORT" as const,
        reportId,
        createdAt: t,
      }));

      await db.transaction("rw", db.reports, db.activities, db.pendings, db.syncQueue, async () => {
        await db.activities.where("reportId").anyOf(ids).delete();
        await db.pendings.where("reportId").anyOf(ids).delete();
        await db.syncQueue.bulkAdd(queueItems);
        await db.reports.bulkDelete(ids);
      });

      cancelDeleteMode();
      load();

      // ✅ toast UNDO (5s)
      const timeoutId = setTimeout(() => setUndoData(null), 5000);
      setUndoData({
        reports: reportsToDelete,
        activities: activitiesToDelete,
        pendings: pendingsToDelete,
        queueItems,
        timeoutId,
      });

    } catch (err: any) {
      alert("❌ Erro ao excluir. Veja o console.");
      console.error(err);
    }
  }

  async function undoDelete() {
    if (!undoData) return;
    clearTimeout(undoData.timeoutId);

    await db.transaction("rw", db.reports, db.activities, db.pendings, db.syncQueue, async () => {
      await db.reports.bulkAdd(undoData.reports);
      await db.activities.bulkAdd(undoData.activities);
      await db.pendings.bulkAdd(undoData.pendings);

      // remove as deleções agendadas
      const idsToRemove = undoData.queueItems.map((i) => i.id);
      await db.syncQueue.bulkDelete(idsToRemove);
    });

    setUndoData(null);
    load();
  }

  async function syncNowManual() {
    setSyncMsg("");
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;

    const res = await syncNow(userId);

    if (!res.ok) {
      setSyncMsg(`❌ Sync falhou: ${res.error}`);
    } else {
      setSyncMsg(res.synced > 0 ? `✅ Sync ok! ${res.synced} item(ns) sincronizados.` : "✅ Nada para sincronizar.");
    }

    load();
  }

  const smallBtnStyle: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 13,
    borderRadius: 10,
    height: "auto",
  };

  function renderSyncBadge() {
    if (syncState === "OFFLINE") return <span className="badge">🔴 Offline</span>;
    if (syncState === "PENDING") return <span className="badge">🟠 Pendente de Sync</span>;
    return <span className="badge">🟢 Sincronizado</span>;
  }

  return (
    <div className="container">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 className="h1" style={{ margin: 0 }}>Relatórios</h1>
          {renderSyncBadge()}
        </div>

        <div className="actions" style={{ marginTop: -6 }}>
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
  onMouseEnter={(e) => {
    const el = e.currentTarget as HTMLButtonElement;
    el.style.transform = "translateY(-1px)";
    el.style.boxShadow = "0 10px 22px rgba(0,0,0,0.20)";
    el.style.borderColor = "rgba(255,255,255,0.22)";
  }}
  onMouseLeave={(e) => {
    const el = e.currentTarget as HTMLButtonElement;
    el.style.transform = "translateY(0px)";
    el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.15)";
    el.style.borderColor = "rgba(255,255,255,0.10)";
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
  <path d="M21 2v6h-6" />
  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
  <path d="M3 22v-6h6" />
  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
</svg>


</button>


          {!selectMode ? (
            <button className="btn danger" style={smallBtnStyle} onClick={enterDeleteMode}>
              Excluir
            </button>
          ) : (
            <>
              <button
                className="btn danger"
                style={smallBtnStyle}
                onClick={deleteSelected}
                disabled={selectedIds.size === 0}
              >
                Excluir ({selectedIds.size})
              </button>
              <button className="btn secondary" style={smallBtnStyle} onClick={cancelDeleteMode}>
                Cancelar
              </button>
            </>
          )}

          <Link
  className="btn"
  to="/new"
  style={{
    ...smallBtnStyle,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    textDecoration: "none",
  }}
>
  Novo Relatório
</Link>

        </div>
      </div>

      {/* ✅ mensagem do sync */}
      {syncMsg && (
        <div className="card" style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}>{syncMsg}</p>
        </div>
      )}

      {/* ✅ busca */}
      <div className="card" style={{ marginTop: 10 }}>
        <label>Buscar no histórico</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ex: 4x4 A, diurno, 04/01/2026, assinatura..."
        />
      </div>

      {/* ✅ selecionar todos */}
      {selectMode && (
        <div className="card" style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(e) => {
                if (e.target.checked) selectAllVisible();
                else clearSelection();
              }}
              style={{ width: 18, height: 18 }}
            />
            <strong>{allVisibleSelected ? "Desmarcar todos" : "Selecionar todos os relatórios exibidos"}</strong>
            <span className="muted">({selectedIds.size}/{filteredReports.length})</span>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 10 }}>
        <h2 className="h2">Histórico</h2>

        <div className="list">
          {filteredReports.length === 0 && <p className="muted">Nenhum relatório encontrado.</p>}

          {filteredReports.map((r) => {
            const checked = selectedIds.has(r.id);
            const openCount = openCountMap[r.id] ?? 0;

            const content = (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <strong>
                    {r.shiftLetter} — {r.shift} — {formatDateBR(r.date)}
                  </strong>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {openCount > 0 && <span className="badge">📌 Pendentes: {openCount}</span>}
                    <span className="badge">Status: {r.status}</span>
                  </div>
                </div>
                <div className="muted">Assinatura: {r.signatureName || "-"}</div>
              </>
            );

            if (selectMode) {
              return (
                <div
                  key={r.id}
                  className="item"
                  onClick={() => toggleSelect(r.id)}
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div style={{ width: 26, display: "flex", justifyContent: "center" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 18, height: 18 }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>{content}</div>
                </div>
              );
            }

            return (
              <Link key={r.id} to={`/report/${r.id}`} className="item">
                {content}
              </Link>
            );
          })}
        </div>
      </div>

      {/* ✅ TOAST DESFAZER */}
      {undoData && (
        <div
          className="card"
          style={{
            position: "fixed",
            bottom: 14,
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: 520,
            width: "calc(100% - 24px)",
            zIndex: 9999,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <strong>Relatórios excluídos.</strong>
              <div className="muted">Você pode desfazer em 5 segundos.</div>
            </div>
            <button className="btn secondary" style={smallBtnStyle} onClick={undoDelete}>
              Desfazer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

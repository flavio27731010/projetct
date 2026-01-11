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

  // ✅ desfazer exclusão (somente local por 5s)
  const [undoData, setUndoData] = useState<{
    reports: Report[];
    pendings: Pending[];
    activities: any[];
    queueItems: any[];
    timeoutId: any;
  } | null>(null);

  async function load() {
    // ✅ NÃO CARREGA REPORTS DELETADOS
    const all = await db.reports.orderBy("updatedAt").reverse().toArray();
    const list = all.filter((r) => !r.deletedAt);

    setReports(list);

    // ✅ pendências abertas por relatório
    const map: Record<string, number> = {};

    for (const r of list) {
      const count = await db.pendings
        .where("reportId")
        .equals(r.id)
        .and((p) => p.status !== "RESOLVIDO")
        .count();

      map[r.id] = count;
    }

    setOpenCountMap(map);

    const queue = await db.syncQueue.count();
    if (!navigator.onLine) setSyncState("OFFLINE");
    else if (queue > 0) setSyncState("PENDING");
    else setSyncState("OK");
  }

  // ✅ ao abrir a Home, sincroniza global e carrega
  useEffect(() => {
    async function boot() {
      setSyncMsg("");

      const { data } = await supabase.auth.getUser();
      const user = data.user;

      if (user) {
        try {
          await syncNow();
        } catch (err: any) {
          console.error(err);
        }
      }

      load();
    }

    boot();
    const interval = setInterval(load, 1500);
    return () => clearInterval(interval);
  }, []);

  // ✅ sincroniza automaticamente quando voltar internet
  useEffect(() => {
    async function onOnline() {
      setSyncMsg("");

      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return;

      try {
        await syncNow();
        setSyncMsg("✅ Internet voltou — dados sincronizados.");
      } catch (err: any) {
        console.error(err);
        setSyncMsg("❌ Falha ao sincronizar quando voltou internet.");
      }

      load();
    }

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ✅ SEM SENHA: entra direto no modo de exclusão
  function enterDeleteMode() {
    setSelectMode(true);
    setSelectedIds(new Set());
  }

  function cancelDeleteMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;

    return reports.filter((r) => {
      const txt =
        `${r.shiftLetter} ${r.shift} ${r.date} ${formatDateBR(r.date)} ${r.signatureName} ${r.status}`.toLowerCase();
      return txt.includes(q);
    });
  }, [query, reports]);

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
      alert("Selecione pelo menos 1 relatório em rascunho para excluir.");
      return;
    }

    const ok = confirm(
      `⚠️ Você irá excluir ${selectedIds.size} relatório(s) GLOBALMENTE. Deseja continuar?`
    );
    if (!ok) return;

    const ids = Array.from(selectedIds);
    const t = nowISO();

    try {
      // ✅ captura dados para UNDO local
      const reportsToDelete = (await db.reports.bulkGet(ids)).filter(Boolean) as Report[];
      const activitiesToDelete = await db.activities.where("reportId").anyOf(ids).toArray();
      const pendingsToDelete = await db.pendings.where("reportId").anyOf(ids).toArray();

      const queueItems = ids.map((reportId) => ({
        id: uuid(),
        type: "UPSERT_REPORT" as const,
        reportId,
        createdAt: t,
      }));

      await db.transaction("rw", db.reports, db.activities, db.pendings, db.syncQueue, async () => {
        // ✅ soft delete global
        for (const rid of ids) {
          await db.reports.update(rid, {
            deletedAt: t,
            updatedAt: t,
            syncVersion: 999999,
          });
        }

        // ✅ remove localmente pra sumir da tela
        await db.activities.where("reportId").anyOf(ids).delete();
        await db.pendings.where("reportId").anyOf(ids).delete();
        await db.syncQueue.bulkAdd(queueItems);
        await db.reports.bulkDelete(ids);
      });

      cancelDeleteMode();
      load();

      // ✅ toast UNDO (5s) (somente local)
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
      // restaura localmente os relatórios (sem deletedAt)
      const restoredReports = undoData.reports.map((r) => ({
        ...r,
        deletedAt: null,
        updatedAt: nowISO(),
        syncVersion: (r.syncVersion ?? 1) + 1,
      }));

      await db.reports.bulkAdd(restoredReports);
      await db.activities.bulkAdd(undoData.activities);
      await db.pendings.bulkAdd(undoData.pendings);

      // remove os jobs agendados
      const idsToRemove = undoData.queueItems.map((i) => i.id);
      await db.syncQueue.bulkDelete(idsToRemove);
    });

    setUndoData(null);
    load();
  }

  // ✅ Sync manual GLOBAL
  async function syncNowManual() {
    setSyncMsg("");

    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) {
      setSyncMsg("❌ Você precisa estar logado para sincronizar.");
      return;
    }

    try {
      await syncNow();
      setSyncMsg("✅ Sync concluído com sucesso!");
    } catch (err: any) {
      console.error(err);
      setSyncMsg("❌ Sync falhou. Veja o console.");
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
          <h1
            style={{
              margin: 0,
              fontSize: "28px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "2px",
              fontFamily: "'Poppins', sans-serif",
            }}
          >
            RELATÓRIOS
          </h1>

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
          >
            🔄
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

      {syncMsg && (
        <div className="card" style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}>{syncMsg}</p>
        </div>
      )}

      <div className="card" style={{ marginTop: 10 }}>
        <label>Buscar no histórico</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ex: 4x4 A, diurno, 04/01/2026, assinatura..."
        />
      </div>

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
            <span className="muted">
              ({selectedIds.size}/{filteredReports.length})
            </span>
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
                    {openCount > 0 && <span className="badge">⏳ Pendência: {openCount}</span>}
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
              <div className="muted">Você pode desfazer em 5 segundos (apenas local).</div>
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

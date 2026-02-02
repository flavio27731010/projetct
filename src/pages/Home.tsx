import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../lib/db";
import type { Activity, Pending, Report } from "../lib/db";
import { formatDateBR, nowISO, uuid } from "../lib/utils";
import { supabase } from "../lib/supabase";
import { syncNow } from "../lib/sync";
import { generateReportPDF } from "../lib/pdf";

export default function Home() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ✅ Detecta se é celular (Android/iPhone)
  const isMobile = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  // ✅ Busca
  const [query, setQuery] = useState("");

  // ✅ contagem pendências abertas por report
  const [openCountMap, setOpenCountMap] = useState<Record<string, number>>({});

  // ✅ indicador de sync
  const [, setSyncState] = useState<"OK" | "PENDING" | "OFFLINE">("OK");

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

    // ✅ Ordena: RASCUNHO primeiro, depois data mais recente, depois updatedAt
    const sorted = [...list].sort((a, b) => {
      // 1) RASCUNHO sempre em primeiro
      if (a.status !== b.status) {
        if (a.status === "RASCUNHO") return -1;
        if (b.status === "RASCUNHO") return 1;
      }

      // 2) data do relatório (mais recente primeiro)
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;

      // 3) desempate por updatedAt (mais recente primeiro)
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    setReports(sorted);

    // ✅ pendências abertas por relatório
    const map: Record<string, number> = {};

    for (const r of sorted) {
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

      // ✅ jobs (reusar esse array no undo)
      const queueItems = ids.map((reportId) => ({
        id: uuid(),
        type: "UPSERT_REPORT" as const,
        reportId,
        createdAt: t,
      }));

      await db.transaction("rw", db.reports, db.activities, db.pendings, db.syncQueue, async () => {
        // ✅ soft delete: mantém o report no Dexie (não bulkDelete!)
        for (const rid of ids) {
          const curr = await db.reports.get(rid);
          await db.reports.update(rid, {
            deletedAt: t,
            updatedAt: t,
            syncVersion: (curr?.syncVersion ?? 0) + 1,
          });
        }

        // ✅ limpar dados locais associados (opcional)
        await db.activities.where("reportId").anyOf(ids).delete();
        await db.pendings.where("reportId").anyOf(ids).delete();

        // ✅ agenda sync (vai subir o report com deletedAt)
        await db.syncQueue.bulkAdd(queueItems);
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
      // ✅ restaura localmente os relatórios (sem deletedAt)
      const restoredReports = undoData.reports.map((r) => ({
        ...r,
        deletedAt: null,
        updatedAt: nowISO(),
        syncVersion: (r.syncVersion ?? 0) + 1,
      }));

      // ✅ PUT (não ADD) pra evitar erro se já existir
      await db.reports.bulkPut(restoredReports);
      await db.activities.bulkPut(undoData.activities);
      await db.pendings.bulkPut(undoData.pendings);

      // ✅ remove os jobs agendados
      const idsToRemove = undoData.queueItems.map((i) => i.id);
      await db.syncQueue.bulkDelete(idsToRemove);
    });

    setUndoData(null);
    load();
  }

  // ✅ Compartilhar WhatsApp (gera PDF local e usa Web Share API quando disponível)
  async function shareReportWhatsApp(reportId: string) {
    const report = await db.reports.get(reportId);
    if (!report) return;
    if (report.status !== "SINCRONIZADO") {
      alert("⚠️ Para compartilhar no WhatsApp, finalize e sincronize o relatório primeiro.");
      return;
    }

    const activities = await db.activities.where("reportId").equals(reportId).toArray();
    const pendings = await db.pendings.where("reportId").equals(reportId).toArray();

    const { blob, filename } = await generateReportPDF(report, activities as Activity[], pendings as Pending[]);
    const file = new File([blob], filename, { type: "application/pdf" });

    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: "Relatório de Turno",
          text: "Segue o relatório em PDF.",
          files: [file],
        });
        return;
      }
    } catch (err) {
      console.error(err);
    }

    // Fallback: baixa o PDF (alguns aparelhos não permitem compartilhar arquivo)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    alert("Seu dispositivo não suportou compartilhamento direto. O PDF foi baixado.");
  }

  const smallBtnStyle: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 13,
    borderRadius: 10,
    height: "auto",
  };

  // ✅ Agrupa por mês (mantém a ordem atual do filteredReports)
  const groupedReports = useMemo(() => {
    const groups: { key: string; title: string; items: Report[] }[] = [];
    const idx = new Map<string, number>();

    const fmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

    for (const r of filteredReports) {
      const d = new Date(r.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const title = fmt.format(new Date(d.getFullYear(), d.getMonth(), 1));

      if (!idx.has(key)) {
        idx.set(key, groups.length);
        groups.push({ key, title, items: [r] });
      } else {
        groups[idx.get(key)!].items.push(r);
      }
    }

    return groups;
  }, [filteredReports]);

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

          {/* ✅ REMOVIDO: {renderSyncBadge()} */}
        </div>

        <div className="actions" style={{ marginTop: -6 }}>
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
            <strong>
              {allVisibleSelected ? "Desmarcar todos" : "Selecionar todos os relatórios exibidos"}
            </strong>
            <span className="muted">({selectedIds.size}/{filteredReports.length})</span>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 10 }}>
        <h2 className="h2">Histórico</h2>

        {filteredReports.length === 0 && <p className="muted">Nenhum relatório encontrado.</p>}

        {/* ✅ Histórico separado por mês */}
        {groupedReports.map((group) => (
          <div key={group.key} style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontWeight: 800, textTransform: "capitalize", marginBottom: 8 }}>
              {group.title}
            </div>

            <div className="list">
              {group.items.map((r) => {
                const checked = selectedIds.has(r.id);
                const openCount = openCountMap[r.id] ?? 0;

                const content = (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <strong>
                        {r.shiftLetter} — {r.shift} — {formatDateBR(r.date)}
                      </strong>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {r.status === "SINCRONIZADO" && isMobile && (
                          <button
                            className="btn secondary"
                            style={smallBtnStyle}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              shareReportWhatsApp(r.id);
                            }}
                          >
                            ➦ WhatsApp
                          </button>
                        )}
                        {openCount > 0 && (
                          <span className="badge">
                            ⏳ {openCount === 1 ? "Pendência" : "Pendências"}: {openCount}
                          </span>
                        )}
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
        ))}
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

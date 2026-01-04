import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../lib/db";
import type { Report } from "../lib/db";
import { formatDateBR, nowISO, uuid } from "../lib/utils"; // se você já tiver uuid/nowISO

export default function Home() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  async function load() {
    const list = await db.reports.orderBy("updatedAt").reverse().toArray();
    setReports(list);
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
    setSelectMode(true);
    setSelectedIds(new Set());
  }

  function cancelDeleteMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) {
      alert("Selecione pelo menos 1 relatório para excluir.");
      return;
    }

    const ok = confirm(
      `⚠️ Você irá excluir ${selectedIds.size} relatório(s). Deseja continuar?`
    );
    if (!ok) return;

    const ids = Array.from(selectedIds);

    try {
      // ✅ Apaga local do Dexie (sumir da tela)
      await db.transaction("rw", db.reports, db.activities, db.pendings, db.syncQueue, async () => {
        // apaga dependências locais
        await db.activities.where("reportId").anyOf(ids).delete();
        await db.pendings.where("reportId").anyOf(ids).delete();

        // ✅ opcional: cria itens na syncQueue pra apagar no Supabase depois (recomendado)
        // (se você não quiser apagar no Supabase, pode remover este bloco)
        const t = nowISO ? nowISO() : new Date().toISOString();
        const items = ids.map((reportId) => ({
          id: uuid ? uuid() : crypto.randomUUID(),
          type: "DELETE_REPORT" as const,
          reportId,
          createdAt: t,
        }));
        await db.syncQueue.bulkAdd(items);

        // apaga o report
        await db.reports.bulkDelete(ids);
      });

      alert("✅ Relatórios excluídos com sucesso!");
      cancelDeleteMode();
      load();
    } catch (err: any) {
      alert("❌ Erro ao excluir. Veja o console.");
      console.error(err);
    }
  }

  return (
    <div className="container">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="h1">Relatórios</h1>

        <div className="actions">
          {!selectMode ? (
            <button className="btn danger" onClick={enterDeleteMode}>
              Excluir
            </button>
          ) : (
            <>
              <button
                className="btn danger"
                onClick={deleteSelected}
                disabled={selectedIds.size === 0}
              >
                Excluir ({selectedIds.size})
              </button>
              <button className="btn secondary" onClick={cancelDeleteMode}>
                Cancelar
              </button>
            </>
          )}

          <Link className="btn" to="/new">
            Novo Relatório
          </Link>
        </div>
      </div>

      <div className="card">
        <h2 className="h2">Histórico</h2>

        <div className="list">
          {reports.length === 0 && <p className="muted">Nenhum relatório criado ainda.</p>}

          {reports.map((r) => {
            const checked = selectedIds.has(r.id);

            const content = (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <strong>
                    {r.shiftLetter} — {r.shift} — {formatDateBR(r.date)}
                  </strong>
                  <span className="badge">Status: {r.status}</span>
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
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { db } from "../lib/db";
import type { Activity, Pending, Report } from "../lib/db";
import { formatDateBR, nowHHmm, nowISO, uuid } from "../lib/utils";
import { generateReportPDF } from "../lib/pdf";
import { syncNow } from "../lib/sync";

export default function ReportDetail() {
  const { id } = useParams();


  const [report, setReport] = useState<Report | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [pendings, setPendings] = useState<Pending[]>([]);
  const [tab, setTab] = useState<"ATIVIDADES" | "PENDENCIAS" | "REVISAO">("ATIVIDADES");

  // ✅ Detecta se é celular (Android/iPhone)
  const isMobile = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  // ✅ New activity
  const [actTime, setActTime] = useState(nowHHmm());
  const [actType, setActType] = useState("");
  const [actDetail, setActDetail] = useState("");

  // ✅ New pending
  const [penPriority, setPenPriority] = useState<Pending["priority"]>("MEDIA");
  const [penType, setPenType] = useState("");
  const [penDetail, setPenDetail] = useState("");

  // ✅ Edit Activity
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [editActTime, setEditActTime] = useState("");
  const [editActDesc, setEditActDesc] = useState("");

  // ✅ Edit Pending
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);
  const [editPenPriority, setEditPenPriority] = useState<Pending["priority"]>("MEDIA");
  const [editPenDesc, setEditPenDesc] = useState("");

  // Separação de pendências por origem
  const inheritedPendings = pendings.filter((p) => p.origin === "HERDADA" && !p.deletedAt);
  const newPendings = pendings.filter((p) => p.origin === "NOVA" && !p.deletedAt);

  // 🔒 trava tudo após FINALIZADO
  // ✅ Bloqueia edição quando o relatório já foi finalizado (mesmo depois de sincronizar)
  const isLocked = report?.status !== "RASCUNHO";

  // ✅ Só permite exportar/compartilhar após finalizar E sincronizar
  const canExport = report?.status === "SINCRONIZADO";

  // Campos obrigatórios:
  // - assinatura
  // - pelo menos 1 atividade
  const requiredOk = useMemo(() => {
    if (!report) return false;
    const hasActs = activities.length > 0;
    return report.signatureName.trim().length > 2 && hasActs;
  }, [report, activities]);

  async function bumpReportVersion() {
    if (!id) return;
    const curr = await db.reports.get(id);
    await db.reports.update(id, {
      updatedAt: nowISO(),
      syncVersion: (curr?.syncVersion ?? 0) + 1,
    });
  }

  async function queueUpsert(reportId: string) {
    // ✅ evita acumular vários jobs iguais
    await db.syncQueue
      .where("reportId")
      .equals(reportId)
      .and((j) => j.type === "UPSERT_REPORT")
      .delete();

    await db.syncQueue.add({
      id: uuid(),
      type: "UPSERT_REPORT",
      reportId,
      createdAt: nowISO(),
    });
  }

  async function load() {
    if (!id) return;

    const r = await db.reports.get(id);
    if (!r) return;

    setReport(r);
    setActivities(await db.activities.where("reportId").equals(id).toArray());
    setPendings(await db.pendings.where("reportId").equals(id).toArray());
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 1200);
    return () => clearInterval(interval);
  }, [id]);

  // ✅ Add Activity (select + detalhe)
  async function addActivity() {
    if (isLocked) return;
    if (!id || !actType.trim()) return;

    const fullDescription = actDetail.trim() ? `${actType} — ${actDetail.trim()}` : actType;

    await db.activities.add({
      id: uuid(),
      reportId: id,
      time: actTime,
      description: fullDescription,
      createdAt: nowISO(),
    });

    await bumpReportVersion();

    setActType("");
    setActDetail("");
    setActTime(nowHHmm());
    load();
  }

  // ✅ Add Pending (select + detalhe)
  async function addPending() {
    if (isLocked) return;
    if (!id || !penType.trim()) return;

    const newId = uuid();
    const fullPendingDesc = penDetail.trim() ? `${penType} — ${penDetail.trim()}` : penType;

    await db.pendings.add({
      id: newId,
      pendingKey: newId,
      reportId: id,
      priority: penPriority,
      description: fullPendingDesc,
      status: "PENDENTE",
      origin: "NOVA",
      createdAt: nowISO(),
    });

    await bumpReportVersion();

    setPenType("");
    setPenDetail("");
    setPenPriority("MEDIA");
    load();
  }

  async function removeActivity(actId: string) {
    if (isLocked) return;
    await db.activities.delete(actId);
    await bumpReportVersion();
    load();
  }

  async function removePending(pId: string) {
    if (isLocked) return;
    const p = await db.pendings.get(pId);
    if (!p) return;

    // ✅ "Remover" = NÃO voltar nunca mais (mesmo em outro aparelho)
    // Estratégia:
    // 1) Marca a pendência como RESOLVIDO em TODOS os relatórios que tenham o mesmo pendingKey
    //    (assim ela nunca mais é herdada em nenhum lugar)
    // 2) Localmente, esconde do RDO atual com deletedAt
    // 3) Agenda sync (UPSERT) de TODOS os reports afetados

    const affected = await db.pendings.where("pendingKey").equals(p.pendingKey).toArray();
    const affectedReportIds = Array.from(new Set(affected.map((x) => x.reportId)));

    await db.pendings.where("pendingKey").equals(p.pendingKey).modify({ status: "RESOLVIDO" });
    await db.pendings.update(pId, { deletedAt: nowISO() });

    // ✅ bump + fila de sync para cada report afetado
    for (const rid of affectedReportIds) {
      const curr = await db.reports.get(rid);
      await db.reports.update(rid, {
        updatedAt: nowISO(),
        syncVersion: (curr?.syncVersion ?? 0) + 1,
      });
      await queueUpsert(rid);
    }

    // ✅ tenta sincronizar já (se tiver internet / login)
    await syncNow();

    load();
  }

  async function markPendingResolved(pId: string) {
    if (isLocked) return;
    const p = await db.pendings.get(pId);
    if (!p || !id) return;

    await db.pendings.where("pendingKey").equals(p.pendingKey).modify({ status: "RESOLVIDO" });

    await bumpReportVersion();
    load();
  }

  async function startEditActivity(a: Activity) {
    if (isLocked) return;
    setEditingActivityId(a.id);
    setEditActTime(a.time);
    setEditActDesc(a.description);
  }

  async function saveEditActivity(aId: string) {
    if (isLocked) return;
    if (!id) return;

    await db.activities.update(aId, {
      time: editActTime,
      description: editActDesc.trim(),
    });

    await bumpReportVersion();

    setEditingActivityId(null);
    load();
  }

  async function startEditPending(p: Pending) {
    if (isLocked) return;
    setEditingPendingId(p.id);
    setEditPenPriority(p.priority);
    setEditPenDesc(p.description);
  }

  async function saveEditPending(pId: string) {
    if (isLocked) return;
    if (!id) return;

    await db.pendings.update(pId, {
      priority: editPenPriority,
      description: editPenDesc.trim(),
    });

    await bumpReportVersion();

    setEditingPendingId(null);
    load();
  }

  // ✅ Salvar PDF
  async function savePDF() {
    if (!report) return;

    const { blob, filename } = await generateReportPDF(report, activities, pendings);

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ✅ Compartilhar WhatsApp (só aparece no celular)
  async function sharePDFWhatsApp() {
    if (!report) return;

    const { blob, filename } = await generateReportPDF(report, activities, pendings);

    const file = new File([blob], filename, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: "Relatório de Turno",
        text: "Segue o relatório em PDF.",
        files: [file],
      });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      alert("Seu celular não suporta compartilhamento direto. PDF foi baixado.");
    }
  }

  async function finalizeAndSync() {
    if (!report || !id) return;

    if (!requiredOk) {
      alert("Preencha os campos obrigatórios: assinatura e ao menos 1 atividade realizada.");
      return;
    }

    await db.reports.update(id, { status: "FINALIZADO", updatedAt: nowISO() });

    await db.syncQueue.add({
      id: uuid(),
      type: "UPSERT_REPORT",
      reportId: id,
      createdAt: nowISO(),
    });

    await syncNow();
    load();

    alert(
      navigator.onLine
        ? "Relatório finalizado e sincronizado!"
        : "Relatório finalizado. Será sincronizado quando voltar internet."
    );

    load();
  }

  if (!report) return <div className="container">Carregando relatório...</div>;

  return (
    <div className="container">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 className="h1">
              {report.shiftLetter} — {report.shift} — {formatDateBR(report.date)}
            </h1>
            <div className="muted">
              Horário: {report.startTime} → {report.endTime} | Turno: {report.shiftLetter} | Status: {report.status}
            </div>

            {isLocked && (
              <div className="badge" style={{ marginTop: 8 }}>
                {report.status === "SINCRONIZADO"
                  ? "✅ Relatório sincronizado — Edição bloqueada"
                  : "🔒 Relatório finalizado — Edição bloqueada"}
              </div>
            )}
          </div>

          <div className="actions">
            {canExport && (
              <button className="btn secondary" onClick={savePDF}>
                Salvar PDF
              </button>
            )}

            {canExport && isMobile && (
              <button className="btn secondary" onClick={sharePDFWhatsApp}>
                ➦ WhatsApp
              </button>
            )}

            <button className="btn" onClick={finalizeAndSync} disabled={!requiredOk || isLocked}>
              Finalizar & Sync
            </button>
          </div>
        </div>

        <div className="hr" />

        <div className="row">
          <button className={`btn ${tab === "ATIVIDADES" ? "" : "secondary"}`} onClick={() => setTab("ATIVIDADES")}>
            Atividades ({activities.length})
          </button>
          <button className={`btn ${tab === "PENDENCIAS" ? "" : "secondary"}`} onClick={() => setTab("PENDENCIAS")}>
            Pendências ({pendings.length})
          </button>
          <button className={`btn ${tab === "REVISAO" ? "" : "secondary"}`} onClick={() => setTab("REVISAO")}>
            Revisão
          </button>
        </div>

        {/* ===================== ABA ATIVIDADES ===================== */}
        {tab === "ATIVIDADES" && (
          <>
            <div className="hr" />
            <h2 className="h2">Adicionar Atividade Realizada</h2>

            <div className="row">
              <div className="col">
                <label>Hora</label>
                <input value={actTime} onChange={(e) => setActTime(e.target.value)} disabled={!!isLocked} />
              </div>

              <div className="col">
                <label>Descrição</label>
                <select value={actType} onChange={(e) => setActType(e.target.value)} disabled={!!isLocked}>
                  <option value="">Selecione...</option>
                  <option value="Granulometria a Laser">Granulometria a Laser</option>
                  <option value="Execução">Execução</option>
                  <option value="Preparação de Amostras">Preparação de Amostras</option>
                  <option value="Outras Atividades">Outras Atividades</option>
                </select>
              </div>
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <div className="col">
                <label>Detalhes / Observação</label>
                <input
                  value={actDetail}
                  onChange={(e) => setActDetail(e.target.value)}
                  placeholder="Digite livremente os detalhes da atividade..."
                  disabled={!!isLocked}
                />
              </div>
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn" onClick={addActivity} disabled={!!isLocked || !actType.trim()}>
                Adicionar
              </button>
              <button className="btn secondary" onClick={() => setTab("PENDENCIAS")}>
                Próximo »
              </button>
            </div>

            <div className="hr" />
            <h2 className="h2">Lista de Atividades</h2>

            <div className="list">
              {activities.length === 0 && <p className="muted">Nenhuma atividade registrada.</p>}

              {activities
                .sort((a, b) => a.time.localeCompare(b.time))
                .map((a) => {
                  const isEditing = !isLocked && editingActivityId === a.id;

                  return (
                    <div key={a.id} className="item">
                      {!isEditing ? (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <strong>{a.time}</strong>

                            <div style={{ display: "flex", gap: 6 }}>
                              <button className="btn secondary" onClick={() => startEditActivity(a)} disabled={!!isLocked}>
                                Editar
                              </button>
                              <button className="btn danger" onClick={() => removeActivity(a.id)} disabled={!!isLocked}>
                                Remover
                              </button>
                            </div>
                          </div>

                          <div className="muted">{a.description}</div>
                        </>
                      ) : (
                        <>
                          <div className="row">
                            <div className="col">
                              <label>Hora</label>
                              <input value={editActTime} onChange={(e) => setEditActTime(e.target.value)} />
                            </div>

                            <div className="col">
                              <label>Descrição</label>
                              <input value={editActDesc} onChange={(e) => setEditActDesc(e.target.value)} />
                            </div>
                          </div>

                          <div className="actions" style={{ marginTop: 8 }}>
                            <button className="btn" onClick={() => saveEditActivity(a.id)} disabled={!editActDesc.trim()}>
                              Salvar
                            </button>
                            <button className="btn secondary" onClick={() => setEditingActivityId(null)}>
                              Cancelar
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          </>
        )}

        {/* ===================== ABA PENDÊNCIAS ===================== */}
        {tab === "PENDENCIAS" && (
          <>
            <div className="hr" />
            <h2 className="h2">Adicionar Pendência (Nova)</h2>

            <div className="row">
              <div className="col">
                <label>Prioridade</label>
                <select
                  value={penPriority}
                  onChange={(e) => setPenPriority(e.target.value as any)}
                  disabled={!!isLocked}
                >
                  <option value="BAIXA">Baixa</option>
                  <option value="MEDIA">Média</option>
                  <option value="ALTA">Alta</option>
                  <option value="URGENTE">Urgente</option>
                </select>
              </div>

              <div className="col">
                <label>Descrição</label>
                <select value={penType} onChange={(e) => setPenType(e.target.value)} disabled={!!isLocked}>
                  <option value="">Selecione...</option>
                  <option value="Granulometria a laser">Granulometria a laser</option>
                  <option value="Execução">Execução</option>
                  <option value="Preparação de Amostra">Preparação de Amostra</option>
                  <option value="Manutenção">Manutenção</option>
                  <option value="Amostras Pendentes">Amostras Pendentes</option>
                  <option value="Falha de Equipamento">Falha de Equipamento</option>
                  <option value="Calibração/Verificação">Calibração/Verificação</option>
                  <option value="Outras Pendências">Outras Pendências</option>
                </select>
              </div>
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <div className="col">
                <label>Detalhes / Observação</label>
                <input
                  value={penDetail}
                  onChange={(e) => setPenDetail(e.target.value)}
                  placeholder="Digite livremente os detalhes da pendência..."
                  disabled={!!isLocked}
                />
              </div>
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn secondary" onClick={() => setTab("ATIVIDADES")}>
                « Anterior
              </button>

              <button className="btn" onClick={addPending} disabled={!!isLocked || !penType.trim()}>
                Adicionar
              </button>

              <button className="btn secondary" onClick={() => setTab("REVISAO")}>
                Próximo »
              </button>
            </div>

            <div className="hr" />

            {/* ---------- HERDADAS ---------- */}
            <h2 className="h2">Pendências Herdadas (Turnos Anteriores)</h2>
            <div className="list">
              {inheritedPendings.length === 0 && <p className="muted">Nenhuma pendência herdada.</p>}

              {inheritedPendings.map((p) => {
                const isEditing = !isLocked && editingPendingId === p.id;

                return (
                  <div key={p.id} className="item">
                    {!isEditing ? (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <strong>
                            {p.priority} • {p.status}
                          </strong>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {!isLocked && p.status !== "RESOLVIDO" && (
                              <button className="btn secondary" onClick={() => markPendingResolved(p.id)}>
                                Resolvido
                              </button>
                            )}

                            <button className="btn secondary" onClick={() => startEditPending(p)} disabled={!!isLocked}>
                              Editar
                            </button>

                            <button className="btn danger" onClick={() => removePending(p.id)} disabled={!!isLocked}>
                              Remover
                            </button>
                          </div>
                        </div>

                        <div className="muted">{p.description}</div>
                        <div className="badge">Herdada</div>
                      </>
                    ) : (
                      <>
                        <div className="row">
                          <div className="col">
                            <label>Prioridade</label>
                            <select
                              value={editPenPriority}
                              onChange={(e) => setEditPenPriority(e.target.value as any)}
                            >
                              <option value="BAIXA">Baixa</option>
                              <option value="MEDIA">Média</option>
                              <option value="ALTA">Alta</option>
                              <option value="URGENTE">Urgente</option>
                            </select>
                          </div>

                          <div className="col">
                            <label>Descrição</label>
                            <input value={editPenDesc} onChange={(e) => setEditPenDesc(e.target.value)} />
                          </div>
                        </div>

                        <div className="actions" style={{ marginTop: 8 }}>
                          <button className="btn" onClick={() => saveEditPending(p.id)} disabled={!editPenDesc.trim()}>
                            Salvar
                          </button>
                          <button className="btn secondary" onClick={() => setEditingPendingId(null)}>
                            Cancelar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="hr" />

            {/* ---------- NOVAS ---------- */}
            <h2 className="h2">Pendências Novas do Turno</h2>
            <div className="list">
              {newPendings.length === 0 && <p className="muted">Nenhuma pendência nova.</p>}

              {newPendings.map((p) => {
                const isEditing = !isLocked && editingPendingId === p.id;

                return (
                  <div key={p.id} className="item">
                    {!isEditing ? (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <strong>
                            {p.priority} • {p.status}
                          </strong>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {!isLocked && p.status !== "RESOLVIDO" && (
                              <button className="btn secondary" onClick={() => markPendingResolved(p.id)}>
                                Marcar Resolvido
                              </button>
                            )}

                            <button className="btn secondary" onClick={() => startEditPending(p)} disabled={!!isLocked}>
                              Editar
                            </button>

                            <button className="btn danger" onClick={() => removePending(p.id)} disabled={!!isLocked}>
                              Remover
                            </button>
                          </div>
                        </div>

                        <div className="muted">{p.description}</div>
                        <div className="badge">Nova</div>
                      </>
                    ) : (
                      <>
                        <div className="row">
                          <div className="col">
                            <label>Prioridade</label>
                            <select
                              value={editPenPriority}
                              onChange={(e) => setEditPenPriority(e.target.value as any)}
                            >
                              <option value="BAIXA">Baixa</option>
                              <option value="MEDIA">Média</option>
                              <option value="ALTA">Alta</option>
                              <option value="URGENTE">Urgente</option>
                            </select>
                          </div>

                          <div className="col">
                            <label>Descrição</label>
                            <input value={editPenDesc} onChange={(e) => setEditPenDesc(e.target.value)} />
                          </div>
                        </div>

                        <div className="actions" style={{ marginTop: 8 }}>
                          <button className="btn" onClick={() => saveEditPending(p.id)} disabled={!editPenDesc.trim()}>
                            Salvar
                          </button>
                          <button className="btn secondary" onClick={() => setEditingPendingId(null)}>
                            Cancelar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ===================== ABA REVISÃO ===================== */}
        {tab === "REVISAO" && (
          <>
            <div className="hr" />
            <h2 className="h2">Revisão</h2>

            <p className="muted">
              Obrigatórios: <strong>assinatura</strong> e pelo menos <strong>1 atividade</strong>.
            </p>

            <div className="row">
              <div className="col">
                <label>Assinatura (Nome)</label>
                <input
                  value={report.signatureName}
                  disabled={!!isLocked}
                  onChange={async (e) => {
                    if (isLocked) return;
                    await db.reports.update(report.id, { signatureName: e.target.value, updatedAt: nowISO() });
                    await bumpReportVersion();
                    load();
                  }}
                />
              </div>
            </div>

            <div className="hr" />

            <div className="badge">Atividades: {activities.length}</div>{" "}
            <div className="badge">Pendências: {pendings.length}</div>{" "}
            <div className="badge">Pronto p/ Finalizar: {requiredOk ? "SIM" : "NÃO"}</div>

            <div className="hr" />

            <button className="btn secondary" onClick={() => setTab("PENDENCIAS")} style={{ marginLeft: "auto" }}>
              « Anterior
            </button>
          </>
        )}
      </div>
    </div>
  );
}

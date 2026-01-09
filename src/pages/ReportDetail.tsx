import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../lib/db";
import type { Activity, Pending, Report } from "../lib/db";
import { formatDateBR, nowHHmm, nowISO, uuid } from "../lib/utils";
import { generateReportPDF } from "../lib/pdf";
import { syncNow } from "../lib/sync";

export default function ReportDetail() {
  const { id } = useParams();
  const nav = useNavigate();

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

  // ✅ New pending (AGORA COM SELECT + DETALHE)
  const [penPriority, setPenPriority] = useState<Pending["priority"]>("MEDIA");
  const [penType, setPenType] = useState("");
  const [penDetail, setPenDetail] = useState("");

  // Separação de pendências por origem
  const inheritedPendings = pendings.filter((p) => p.origin === "HERDADA");
  const newPendings = pendings.filter((p) => p.origin === "NOVA");

  // Campos obrigatórios:
  // - assinatura
  // - pelo menos 1 atividade
  const requiredOk = useMemo(() => {
    if (!report) return false;
    const hasActs = activities.length > 0;
    return report.signatureName.trim().length > 2 && hasActs;
  }, [report, activities]);

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
    if (!id || !actType.trim()) return;

    const fullDescription = actDetail.trim()
      ? `${actType} — ${actDetail.trim()}`
      : actType;

    await db.activities.add({
      id: uuid(),
      reportId: id,
      time: actTime,
      description: fullDescription,
      createdAt: nowISO(),
    });

    await db.reports.update(id, {
      updatedAt: nowISO(),
      syncVersion: (report?.syncVersion ?? 1) + 1,
    });

    setActType("");
    setActDetail("");
    setActTime(nowHHmm());
    load();
  }

  // ✅ Add Pending (select + detalhe)
  async function addPending() {
    if (!id || !penType.trim()) return;

    const newId = uuid();

    const fullPendingDesc = penDetail.trim()
      ? `${penType} — ${penDetail.trim()}`
      : penType;

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

    await db.reports.update(id, {
      updatedAt: nowISO(),
      syncVersion: (report?.syncVersion ?? 1) + 1,
    });

    setPenType("");
    setPenDetail("");
    setPenPriority("MEDIA");
    load();
  }

  async function removeActivity(actId: string) {
    await db.activities.delete(actId);
    await db.reports.update(id!, {
      updatedAt: nowISO(),
      syncVersion: (report?.syncVersion ?? 1) + 1,
    });
    load();
  }

  async function removePending(pId: string) {
    await db.pendings.delete(pId);
    await db.reports.update(id!, {
      updatedAt: nowISO(),
      syncVersion: (report?.syncVersion ?? 1) + 1,
    });
    load();
  }

  async function markPendingResolved(pId: string) {
    const p = await db.pendings.get(pId);
    if (!p) return;

    const now = nowISO();

    await db.pendings.where("pendingKey").equals(p.pendingKey).modify({ status: "RESOLVIDO" });

    await db.reports.update(id!, {
      updatedAt: now,
      syncVersion: (report?.syncVersion ?? 1) + 1,
    });

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

    nav("/");
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
          </div>

          <div className="actions">
            <button className="btn secondary" onClick={savePDF}>
              Salvar PDF
            </button>

            {isMobile && (
              <button className="btn secondary" onClick={sharePDFWhatsApp}>
                ➦ WhatsApp
              </button>
            )}

            <button className="btn" onClick={finalizeAndSync} disabled={!requiredOk}>
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
                <input value={actTime} onChange={(e) => setActTime(e.target.value)} />
              </div>

              <div className="col">
                <label>Descrição</label>
                <select value={actType} onChange={(e) => setActType(e.target.value)}>
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
                />
              </div>
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn" onClick={addActivity} disabled={!actType.trim()}>
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
                .map((a) => (
                  <div key={a.id} className="item">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <strong>{a.time}</strong>
                      <button className="btn danger" onClick={() => removeActivity(a.id)}>
                        Remover
                      </button>
                    </div>
                    <div className="muted">{a.description}</div>
                  </div>
                ))}
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
                <select value={penPriority} onChange={(e) => setPenPriority(e.target.value as any)}>
                  <option value="BAIXA">Baixa</option>
                  <option value="MEDIA">Média</option>
                  <option value="ALTA">Alta</option>
                  <option value="URGENTE">Urgente</option>
                </select>
              </div>

              <div className="col">
                <label>Descrição</label>
                <select value={penType} onChange={(e) => setPenType(e.target.value)}>
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
                />
              </div>
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn secondary" onClick={() => setTab("ATIVIDADES")}>
                « Anterior
              </button>

              <button className="btn" onClick={addPending} disabled={!penType.trim()}>
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

              {inheritedPendings.map((p) => (
                <div key={p.id} className="item">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <strong>
                      {p.priority} • {p.status}
                    </strong>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {p.status !== "RESOLVIDO" && (
                        <button className="btn secondary" onClick={() => markPendingResolved(p.id)}>
                          Resolvido
                        </button>
                      )}
                      <button className="btn danger" onClick={() => removePending(p.id)}>
                        Remover
                      </button>
                    </div>
                  </div>

                  <div className="muted">{p.description}</div>
                  <div className="badge">Herdada</div>
                </div>
              ))}
            </div>

            <div className="hr" />

            {/* ---------- NOVAS ---------- */}
            <h2 className="h2">Pendências Novas do Turno</h2>
            <div className="list">
              {newPendings.length === 0 && <p className="muted">Nenhuma pendência nova.</p>}

              {newPendings.map((p) => (
                <div key={p.id} className="item">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <strong>
                      {p.priority} • {p.status}
                    </strong>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {p.status !== "RESOLVIDO" && (
                        <button className="btn secondary" onClick={() => markPendingResolved(p.id)}>
                          Marcar Resolvido
                        </button>
                      )}
                      <button className="btn danger" onClick={() => removePending(p.id)}>
                        Remover
                      </button>
                    </div>
                  </div>

                  <div className="muted">{p.description}</div>
                  <div className="badge">Nova</div>
                </div>
              ))}
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
                  onChange={async (e) => {
                    await db.reports.update(report.id, { signatureName: e.target.value, updatedAt: nowISO() });
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

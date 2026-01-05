import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../lib/db";
import type { Activity, Pending, Report } from "../lib/db";
import { formatDateBR, nowHHmm, nowISO, uuid } from "../lib/utils";
import { generateReportPDF } from "../lib/pdf";
import { supabase } from "../lib/supabase";
import { syncNow } from "../lib/sync";

export default function ReportDetail() {
  const { id } = useParams();
  const nav = useNavigate();

  const [report, setReport] = useState<Report | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [pendings, setPendings] = useState<Pending[]>([]);
  const [tab, setTab] = useState<"ATIVIDADES" | "PENDENCIAS" | "REVISAO">("ATIVIDADES");

  // New activity
  const [actDesc, setActDesc] = useState("");
  const [actTime, setActTime] = useState(nowHHmm());

  // New pending
  const [penDesc, setPenDesc] = useState("");
  const [penPriority, setPenPriority] = useState<Pending["priority"]>("MEDIA");

  // Separação de pendências por origem
  const inheritedPendings = pendings.filter((p) => p.origin === "HERDADA");
  const newPendings = pendings.filter((p) => p.origin === "NOVA");

  // Campos obrigatórios:
  // - assinatura
  // - pelo menos 1 atividade
  // - pelo menos 1 pendência
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

  async function addActivity() {
    if (!id || !actDesc.trim()) return;

    await db.activities.add({
      id: uuid(),
      reportId: id,
      time: actTime,
      description: actDesc.trim(),
      createdAt: nowISO(),
    });

    await db.reports.update(id, {
      updatedAt: nowISO(),
      syncVersion: (report?.syncVersion ?? 1) + 1,
    });

    setActDesc("");
    setActTime(nowHHmm());
    load();
  }

  async function addPending() {
    if (!id || !penDesc.trim()) return;

    const newId = uuid();

    await db.pendings.add({
      id: newId,
      pendingKey: newId, // ✅ identidade global
      reportId: id,
      priority: penPriority,
      description: penDesc.trim(),
      status: "PENDENTE",
      origin: "NOVA",
      createdAt: nowISO(),
    });

    await db.reports.update(id, {
      updatedAt: nowISO(),
      syncVersion: (report?.syncVersion ?? 1) + 1,
    });

    setPenDesc("");
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

  // ✅ resolve TODAS as pendências da mesma identidade global
  // (original + todas as cópias herdadas existentes)
  await db.pendings
    .where("pendingKey")
    .equals(p.pendingKey)
    .modify({ status: "RESOLVIDO" });

  // ✅ NÃO DELETA MAIS!
  // -> Assim ela continua visível no relatório atual
  // -> E aparece no PDF como RESOLVIDO

  await db.reports.update(id!, {
    updatedAt: now,
    syncVersion: (report?.syncVersion ?? 1) + 1,
  });

  load();
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
    createdAt: nowISO()
  });

  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;

  if (userId) await syncNow(userId);

  load();

  alert(
    navigator.onLine
      ? "Relatório finalizado e sincronizado!"
      : "Relatório finalizado. Será sincronizado quando voltar internet."
  );

  // ✅ Volta automaticamente para a Home
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
            <button className="btn secondary" onClick={() => nav("/")}>
              Voltar
            </button>
            <button className="btn secondary" onClick={async () => await generateReportPDF(report, activities, pendings)}>
              Gerar PDF
            </button>
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
                <input
                  value={actDesc}
                  onChange={(e) => setActDesc(e.target.value)}
                  placeholder="Ex: Coleta de caracterização..."
                />
              </div>
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn" onClick={addActivity} disabled={!actDesc.trim()}>
                Adicionar
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
                  <option value="Baixa">Baixa</option>
                  <option value="Média">Média</option>
                  <option value="Alta">Alta</option>
                  <option value="Urgente">Urgente</option>
                </select>
              </div>

              <div className="col">
                <label>Descrição</label>
                <input
                  value={penDesc}
                  onChange={(e) => setPenDesc(e.target.value)}
                  placeholder="Ex: Manutenção nos veículos..."
                />
              </div>
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn" onClick={addPending} disabled={!penDesc.trim()}>
                Adicionar
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
                          Marcar Resolvido
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

            <div className="actions">
              <button className="btn secondary" onClick={() => generateReportPDF(report, activities, pendings)}>
                Gerar PDF (offline)
              </button>
              <button className="btn" onClick={finalizeAndSync} disabled={!requiredOk}>
                Finalizar & Sync
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

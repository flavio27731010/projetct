import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/db";
import type { Shift, ShiftLetter } from "../lib/db";
import { nowISO, uuid } from "../lib/utils";
import { inheritOpenPendings } from "../lib/pendingInheritance";

export default function NewReport() {
  const nav = useNavigate();

  // ✅ userId obrigatório no DB
  const userId = localStorage.getItem("userId") || "offline_user";

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [signatureName, setSignatureName] = useState("");

  const [shift, setShift] = useState<Shift>("DIURNO");
  const [reportType, setReportType] = useState<"4x4" | "3x2">("4x4");
  const [shiftLetter, setShiftLetter] = useState("A");

  // ✅ opções de letras dinâmicas
  const letterOptions = useMemo(() => {
    return reportType === "4x4" ? ["A", "B", "C", "D"] : ["A", "B"];
  }, [reportType]);

  // ✅ ShiftLetter com prefixo, para salvar no banco
  const fullShiftLetter = useMemo(() => {
    return `${reportType} ${shiftLetter}` as ShiftLetter;
  }, [reportType, shiftLetter]);

  // ✅ quando muda tipo: garante letra válida
  function handleReportTypeChange(nextType: "4x4" | "3x2") {
    setReportType(nextType);

    // Se escolher 3x2 e a letra atual for C ou D, reseta pra A
    if (nextType === "3x2" && (shiftLetter === "C" || shiftLetter === "D")) {
      setShiftLetter("A");
    }
  }

  // ✅ se for 3x2: força DIURNO e remove NOTURNO
  useEffect(() => {
    if (reportType === "3x2" && shift === "NOTURNO") {
      setShift("DIURNO");
    }
  }, [reportType, shift]);

  async function createReport() {
    if (!signatureName.trim()) {
      alert("Informe o nome do responsável.");
      return;
    }

    const id = uuid();

    await db.reports.add({
      id,
      userId,
      date,
      shift,
      shiftLetter: fullShiftLetter, // ✅ "4x4 A" ou "3x2 B"
      signatureName: signatureName.trim(),
      status: "RASCUNHO",
      startTime: shift === "DIURNO" ? "07:00" : "19:00",
      endTime: shift === "DIURNO" ? "19:00" : "07:00",
      createdAt: nowISO(),
      updatedAt: nowISO(),
      syncVersion: 1,
    });

    // ✅ herda pendências automaticamente (SEM misturar 3x2 com 4x4)
    await inheritOpenPendings(id, fullShiftLetter);

    nav(`/report/${id}`);
  }

  return (
    <div className="container">
      <div className="card">
        <h1 className="h1">Novo Relatório</h1>

        {/* ✅ LINHA 1: Assinatura + Data */}
        <div className="row">
          <div className="col">
            <label>Assinatura (Nome do responsável)*</label>
            <input
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder="Ex: Flavio Silva"
            />
          </div>

          <div className="col">
            <label>Data</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        {/* ✅ LINHA 2: Turno + Letra */}
        <div className="row">
          <div className="col" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ marginTop: 10 }}>Turno</label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value as Shift)}
              disabled={reportType === "3x2"}
            >
              <option value="DIURNO">Diurno (07:00–19:00)</option>

              {reportType === "4x4" && (
                <option value="NOTURNO">Noturno (19:00–07:00)</option>
              )}
            </select>

            {reportType === "3x2" && (
              <div className="muted" style={{ marginTop: 4 }}>
                Relatório <strong>3x2</strong> é somente <strong>Diurno</strong>.
              </div>
            )}
          </div>

          <div className="col" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ marginTop: 10 }}>Letra do Turno</label>
            <select value={shiftLetter} onChange={(e) => setShiftLetter(e.target.value)}>
              {letterOptions.map((l) => (
                <option key={l} value={l}>
                  {reportType} {l}
                </option>
              ))}
            </select>

            <div className="muted" style={{ marginTop: 4 }}>
              Selecionado: <strong>{fullShiftLetter}</strong>
            </div>
          </div>
        </div>

        {/* ✅ Tipo de relatório como TOGGLE (BONITO) */}
        <div className="hr" />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className={`btn ${reportType === "4x4" ? "" : "secondary"}`}
            onClick={() => handleReportTypeChange("4x4")}
            type="button"
          >
            4x4 (A/B/C/D)
          </button>

          <button
            className={`btn ${reportType === "3x2" ? "" : "secondary"}`}
            onClick={() => handleReportTypeChange("3x2")}
            type="button"
          >
            3x2 (A/B)
          </button>
        </div>

        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn" onClick={createReport}>
            Criar Relatório
          </button>
        </div>

        <div className="muted" style={{ marginTop: 10 }}>
          Depois de criado, você adiciona atividades e pendências e gera o PDF offline.
        </div>
      </div>
    </div>
  );
}

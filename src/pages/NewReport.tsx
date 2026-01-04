import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/db";
import type { Shift, ShiftLetter } from "../lib/db";
import { nowISO, shiftTimes, todayISO, uuid } from "../lib/utils";
import { supabase } from "../lib/supabase";

// ✅ herança offline (do relatório anterior)
import { inheritOpenPendings } from "../lib/pendingInheritance";

export default function NewReport() {
  const nav = useNavigate();
  const [date, setDate] = useState(todayISO());
  const [shift, setShift] = useState<Shift>("DIURNO");
  const [shiftLetter, setShiftLetter] = useState<ShiftLetter>("4x4 A"); // ✅ novo campo
  const [signatureName, setSignatureName] = useState("");
  const [loading, setLoading] = useState(false);

  async function create() {
    setLoading(true);

    try {
      // ✅ pega user logado
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;

      // ✅ cria report offline
      const id = uuid();
      const times = shiftTimes(shift);
      const t = nowISO();

      await db.reports.add({
        id,
        userId,
        date,
        shift,
        shiftLetter, // ✅ salva letra do turno
        startTime: times.startTime,
        endTime: times.endTime,
        signatureName: signatureName.trim(),
        status: "RASCUNHO",
        createdAt: t,
        updatedAt: t,
        syncVersion: 1,
      });

      // ✅ herda pendências abertas do último relatório FINALIZADO
      await inheritOpenPendings(id);

      // ✅ abre o relatório recém criado
      nav(`/report/${id}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h1 className="h1">Novo Relatório</h1>

        {/* ✅ Primeira linha: Data + Turno + Letra do Turno */}
        <div className="row">
          <div className="col">
            <label>Data</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="col">
            <label>Turno</label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value as Shift)}
            >
              <option value="DIURNO">Diurno (07:00–19:00)</option>
              <option value="NOTURNO">Noturno (19:00–07:00)</option>
            </select>
          </div>

          <div className="col">
            <label>Letra do Turno</label>
            <select
              value={shiftLetter}
              onChange={(e) => setShiftLetter(e.target.value as ShiftLetter)}
            >
              <option value="4x4 A">4x4 A</option>
              <option value="4x4 B">4x4 B</option>
              <option value="4x4 C">4x4 C</option>
              <option value="4x4 D">4x4 D</option>
            </select>
          </div>
        </div>

        <div className="hr" />

        <label>Assinatura (Nome do responsável)*</label>
        <input
          value={signatureName}
          onChange={(e) => setSignatureName(e.target.value)}
          placeholder="Ex: Flavio Silva"
        />

        <div className="actions" style={{ marginTop: 12 }}>
          <button
            className="btn"
            disabled={loading || signatureName.trim().length < 3}
            onClick={create}
          >
            {loading ? "Criando..." : "Criar Relatório"}
          </button>
        </div>

        <p className="muted" style={{ marginTop: 10 }}>
          Depois de criado, você adiciona atividades e pendências e gera o PDF offline.
        </p>
      </div>
    </div>
  );
}

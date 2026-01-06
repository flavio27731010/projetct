import { db } from "./db";
import { supabase } from "./supabase";

export async function syncNow() {
  // ✅ Se não estiver logado, não sincroniza
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;

  // =====================================================
  // 1) UPLOAD: envia tudo que está na fila
  // =====================================================
  const queue = await db.syncQueue.toArray();

  for (const job of queue) {
    // ✅ UPSERT REPORT (já existia)
    if (job.type === "UPSERT_REPORT") {
      const report = await db.reports.get(job.reportId);
      if (!report) {
        await db.syncQueue.delete(job.id);
        continue;
      }

      const activities = await db.activities.where("reportId").equals(job.reportId).toArray();
     const pendingsRaw = await db.pendings.where("reportId").equals(job.reportId).toArray();

// ✅ função para limpar uuid quebrado (uuid_uuid -> uuid)
const cleanUuid = (v: any) => {
  if (!v) return v;
  const s = String(v);
  return s.includes("_") ? s.split("_")[0] : s;
};

// ✅ corrige todos os campos uuid antes de enviar
const pendings = pendingsRaw.map((p) => ({
  ...p,
  id: cleanUuid(p.id),
  reportId: cleanUuid(p.reportId),
  pendingKey: cleanUuid(p.pendingKey),
  sourcePendingId: p.sourcePendingId ? cleanUuid(p.sourcePendingId) : null,
}));


      // ✅ UPSERT global
      const r1 = await supabase.from("reports").upsert(report);

      // ✅ só envia se tiver registros
      const r2 = activities.length
        ? await supabase.from("activities").upsert(activities)
        : { error: null };

      const r3 = pendings.length
        ? await supabase.from("pendings").upsert(pendings)
        : { error: null };

      // Se deu erro, para aqui (não apaga da fila)
      if (r1.error || r2.error || r3.error) {
        console.error("Erro no sync:", r1.error || r2.error || r3.error);
        return;
      }

      // ✅ remove job da fila se deu certo
      await db.syncQueue.delete(job.id);
    }

    // ✅ DELETE REPORT (NOVO - necessário para limpar a fila)
    if (job.type === "DELETE_REPORT") {
      const reportId = job.reportId;

      // ✅ deleta no Supabase (ordem importa)
      const d1 = await supabase.from("activities").delete().eq("reportId", reportId);
      const d2 = await supabase.from("pendings").delete().eq("reportId", reportId);
      const d3 = await supabase.from("reports").delete().eq("id", reportId);

      if (d1.error || d2.error || d3.error) {
        console.error("Erro deletando no Supabase:", d1.error || d2.error || d3.error);
        return;
      }

      // ✅ remove job da fila se deu certo
      await db.syncQueue.delete(job.id);
    }
  }

  // =====================================================
  // 2) DOWNLOAD: baixa tudo do Supabase (para todos)
  // =====================================================
  const { data: reports, error: e1 } = await supabase.from("reports").select("*");
  const { data: activities, error: e2 } = await supabase.from("activities").select("*");
  const { data: pendings, error: e3 } = await supabase.from("pendings").select("*");

  if (e1 || e2 || e3) {
    console.error("Erro baixando dados:", e1 || e2 || e3);
    return;
  }

  // =====================================================
  // 3) GRAVA no IndexedDB local (cache offline)
  // =====================================================
  if (reports?.length) await db.reports.bulkPut(reports);
  if (activities?.length) await db.activities.bulkPut(activities);
  if (pendings?.length) await db.pendings.bulkPut(pendings);
}

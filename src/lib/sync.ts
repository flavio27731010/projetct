import { db } from "./db";
import { supabase } from "./supabase";

export async function syncNow() {
  // ✅ Se não estiver logado, não sincroniza
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;

  // =====================================================
  // 1) UPLOAD: envia tudo que está na fila
  // =====================================================
  const queue = await db.syncQueue.toArray();

  for (const job of queue) {
    if (job.type === "UPSERT_REPORT") {
      const report = await db.reports.get(job.reportId);

      if (!report) {
        await db.syncQueue.delete(job.id);
        continue;
      }

      const activities = await db.activities.where("reportId").equals(job.reportId).toArray();
      const pendingsRaw = await db.pendings.where("reportId").equals(job.reportId).toArray();

      // ✅ limpa uuid quebrado (uuid_uuid -> uuid)
      const cleanUuid = (v: any) => {
        if (!v) return v;
        const s = String(v);
        return s.includes("_") ? s.split("_")[0] : s;
      };

      const pendings = pendingsRaw.map((p) => ({
        ...p,
        id: cleanUuid(p.id),
        reportId: cleanUuid(p.reportId),
        pendingKey: cleanUuid(p.pendingKey),
        sourcePendingId: p.sourcePendingId ? cleanUuid(p.sourcePendingId) : null,
      }));

      // ✅ UPSERT global (report pode ter deletedAt!)
      const r1 = await supabase.from("reports").upsert(report);
      const r2 = activities.length
        ? await supabase.from("activities").upsert(activities)
        : { error: null };
      const r3 = pendings.length
        ? await supabase.from("pendings").upsert(pendings)
        : { error: null };

      if (r1.error || r2.error || r3.error) {
  alert("❌ Erro no sync: " + JSON.stringify(r1.error || r2.error || r3.error));
  console.error("Erro no sync:", r1.error || r2.error || r3.error);
  return;
}


      await db.syncQueue.delete(job.id);
    }

    // ⚠️ DELETE_REPORT não é mais usado (agora é soft delete)
    if (job.type === "DELETE_REPORT") {
      await db.syncQueue.delete(job.id);
    }
  }

  // =====================================================
  // 2) DOWNLOAD: baixa tudo do Supabase (GLOBAL)
  // ✅ mas ignora reports deletados (deletedAt != null)
  // =====================================================
  const { data: reports, error: e1 } = await supabase.from("reports").select("*");
  const { data: activities, error: e2 } = await supabase.from("activities").select("*");
  const { data: pendings, error: e3 } = await supabase.from("pendings").select("*");

  if (e1 || e2 || e3) {
    console.error("Erro baixando dados:", e1 || e2 || e3);
    return;
  }

  // ✅ separa os reports ativos e os deletados
  const activeReports = (reports || []).filter((r: any) => !r.deletedAt);
  const deletedReports = (reports || []).filter((r: any) => !!r.deletedAt);

  // =====================================================
  // 3) GRAVA no IndexedDB local (cache offline)
  // =====================================================
  if (activeReports.length) await db.reports.bulkPut(activeReports);
  if (activities?.length) await db.activities.bulkPut(activities);
  if (pendings?.length) await db.pendings.bulkPut(pendings);

  // ✅ remove localmente tudo que foi deletado globalmente
  if (deletedReports.length) {
    const deletedIds = deletedReports.map((r: any) => r.id);

    await db.transaction("rw", db.reports, db.activities, db.pendings, async () => {
      await db.activities.where("reportId").anyOf(deletedIds).delete();
      await db.pendings.where("reportId").anyOf(deletedIds).delete();
      await db.reports.bulkDelete(deletedIds);
    });
  }
}

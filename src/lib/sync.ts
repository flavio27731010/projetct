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
     const reportToSend: any = { ...report };

// 🔥 remove lixo/colunas antigas que podem existir no Dexie
delete reportToSend.deletedat;
delete reportToSend.deleted_at;

// ✅ normalize deletedAt
reportToSend.deletedAt = report.deletedAt ?? null;

// ⚠️ se seu schema no Supabase for snake_case, ajuste aqui
// (exemplo: userId -> userid etc). Pelo seu print, parece userId/createdAt/updatedAt iguais ao app.

const r1 = await supabase
  .from("reports")
  .upsert(reportToSend, { onConflict: "id" });

      const r2 = activities.length ? await supabase.from("activities").upsert(activities) : { error: null };
      const r3 = pendings.length ? await supabase.from("pendings").upsert(pendings) : { error: null };

    if (r1.error || r2.error || r3.error) {
  const err = r1.error || r2.error || r3.error;
  console.error("❌ Erro no sync (completo):", err);
  console.error("❌ Payload report enviado:", reportToSend); // (ver passo 2)
  alert("❌ Erro no sync: " + (err?.message ?? JSON.stringify(err)));
  return;
}


      await db.syncQueue.delete(job.id);
    }

    // ⚠️ DELETE_REPORT não é mais usado (soft delete)
    if (job.type === "DELETE_REPORT") {
      await db.syncQueue.delete(job.id);
    }
  }

  // =====================================================
  // 2) DOWNLOAD: baixa tudo do Supabase (GLOBAL)
  // =====================================================
  const { data: reports, error: e1 } = await supabase.from("reports").select("*");
  const { data: activities, error: e2 } = await supabase.from("activities").select("*");
  const { data: pendings, error: e3 } = await supabase.from("pendings").select("*");

  if (e1 || e2 || e3) {
    console.error("Erro baixando dados:", e1 || e2 || e3);
    return;
  }

  const allReports = (reports || []).map((r: any) => {
  const x: any = { ...r };

  // se vier do servidor com outra grafia, normalize
  if ("deletedat" in x) {
    x.deletedAt = x.deletedat;
    delete x.deletedat;
  }
  if ("deleted_at" in x) {
    x.deletedAt = x.deleted_at;
    delete x.deleted_at;
  }

  return x;
});

  const deletedReports = allReports.filter((r: any) => !!r.deletedAt);

  // =====================================================
  // 3) GRAVA no IndexedDB local (cache offline)
  //    ✅ guarda inclusive os deletados
  // =====================================================
  if (allReports.length) await db.reports.bulkPut(allReports);
  if (activities?.length) await db.activities.bulkPut(activities);
  if (pendings?.length) await db.pendings.bulkPut(pendings);

  // ✅ opcional: limpa localmente activities/pendings de reports deletados
  // (mas NÃO apaga o report do Dexie!)
  if (deletedReports.length) {
    const deletedIds = deletedReports.map((r: any) => r.id);

    await db.transaction("rw", db.activities, db.pendings, async () => {
      await db.activities.where("reportId").anyOf(deletedIds).delete();
      await db.pendings.where("reportId").anyOf(deletedIds).delete();
    });
  }
}

import { supabase } from "./supabase";
import { db } from "./db";

export type SyncResult = {
  ok: boolean;
  synced: number;
  error?: string;
};

export async function syncNow(userId: string): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { ok: false, synced: 0, error: "Sem internet" };
  }

  const queue = await db.syncQueue.orderBy("createdAt").toArray();
  let syncedCount = 0;

  for (const item of queue) {
    if (item.type === "UPSERT_REPORT") {
      const report = await db.reports.get(item.reportId);
      if (!report) {
        await db.syncQueue.delete(item.id);
        continue;
      }

      const activities = await db.activities.where("reportId").equals(report.id).toArray();
      const pendings = await db.pendings.where("reportId").equals(report.id).toArray();

      const { error: repErr } = await supabase.from("reports").upsert({
        id: report.id,
        user_id: userId,
        date: report.date,
        shift: report.shift,
        shift_letter: (report as any).shiftLetter ?? null,
        start_time: report.startTime,
        end_time: report.endTime,
        signature_name: report.signatureName,
        status: report.status,
        updated_at: report.updatedAt,
        sync_version: report.syncVersion
      });

      if (repErr) return { ok: false, synced: syncedCount, error: repErr.message };

      await supabase.from("activities").delete().eq("report_id", report.id);
      await supabase.from("pendings").delete().eq("report_id", report.id);

      if (activities.length) {
        const { error } = await supabase.from("activities").insert(
          activities.map(a => ({
            id: a.id,
            report_id: a.reportId,
            time: a.time,
            description: a.description
          }))
        );
        if (error) return { ok: false, synced: syncedCount, error: error.message };
      }

      // ✅ enviar NOVAS e HERDADAS (para ter histórico completo no supabase)
      if (pendings.length) {
        const { error } = await supabase.from("pendings").insert(
          pendings.map(p => ({
            id: p.id,
            report_id: p.reportId,
            priority: p.priority,
            description: p.description,
            status: p.status,
            origin: p.origin,
            source_pending_id: p.sourcePendingId ?? null
          }))
        );
        if (error) return { ok: false, synced: syncedCount, error: error.message };
      }

      await db.reports.update(report.id, { status: "SINCRONIZADO" });
      await db.syncQueue.delete(item.id);
      syncedCount++;
    }

    if (item.type === "DELETE_REPORT") {
      await supabase.from("activities").delete().eq("report_id", item.reportId);
      await supabase.from("pendings").delete().eq("report_id", item.reportId);
      await supabase.from("reports").delete().eq("id", item.reportId);

      await db.syncQueue.delete(item.id);
      syncedCount++;
    }
  }

  return { ok: true, synced: syncedCount };
}

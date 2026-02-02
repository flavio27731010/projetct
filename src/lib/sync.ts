import { db } from "./db";
import { supabase } from "./supabase";


let __isSyncing = false;

export async function syncNow() {
  // ✅ evita concorrência (React StrictMode / cliques repetidos)
  if (__isSyncing) return;
  __isSyncing = true;
  try {
  // ✅ Sem internet, não tenta sincronizar (evita erro/alert spam)
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

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
      const pendingsRawAll = await db.pendings.where("reportId").equals(job.reportId).toArray();
      // ✅ IMPORTANTE:
      // - Não filtramos "deletedAt" aqui, porque o servidor pode não ter essa coluna.
      // - Mesmo assim, precisamos enviar a atualização de status (ex: RESOLVIDO)
      //   para que a pendência não volte em outro aparelho/login.
      const pendingsRaw = pendingsRawAll;

      // ✅ limpa uuid quebrado SOMENTE quando vier no formato uuid_uuid (mesmo valor repetido)
      // ⚠️ NÃO pode quebrar IDs determinísticos que usam '_' (ex: `${reportId}_${pendingKey}`)
      const cleanUuid = (v: any) => {
        if (!v) return v;
        const s = String(v);
        if (!s.includes("_")) return s;

        const parts = s.split("_");
        // caso típico de bug: "uuid_uuid" (duas vezes o mesmo)
        if (parts.length === 2 && parts[0] && parts[0] === parts[1]) return parts[0];
        return s;
      };

      // ✅ evita erro do Postgres: ON CONFLICT DO UPDATE ... row a second time
      //    (acontece quando o payload do upsert contém IDs duplicados no mesmo batch)
      const dedupeById = <T extends { id: string; createdAt?: string }>(arr: T[]) => {
        const map = new Map<string, T>();
        for (const item of arr) {
          const prev = map.get(item.id);
          if (!prev) {
            map.set(item.id, item);
            continue;
          }
          // se tiver duplicado, mantém o mais recente (createdAt ISO)
          const prevTs = prev.createdAt ?? "";
          const curTs = item.createdAt ?? "";
          map.set(item.id, curTs > prevTs ? item : prev);
        }
        return Array.from(map.values());
      };


      const pendings = pendingsRaw.map((p: any) => {
        // remove campos locais que podem não existir no Postgres
        const { deletedAt, deletedat, deleted_at, ...rest } = p;
        return {
        ...rest,
        id: cleanUuid(p.id),
        reportId: cleanUuid(p.reportId),
        pendingKey: cleanUuid(p.pendingKey),
        sourcePendingId: p.sourcePendingId ? cleanUuid(p.sourcePendingId) : null,
        };
      });

      // ✅ UPSERT global (report pode ter deletedAt!)
      const reportToSend: any = { ...report };

// 🔥 remove lixo/colunas antigas que podem existir no Dexie
delete reportToSend.deletedat;
delete reportToSend.deleted_at;

// ✅ normalize deletedAt
      reportToSend.deletedAt = report.deletedAt ?? null;

      // ✅ Se o relatório foi FINALIZADO e subiu com sucesso, marcamos como SINCRONIZADO
      const shouldMarkAsSynced = !reportToSend.deletedAt && report.status === "FINALIZADO";
      if (shouldMarkAsSynced) reportToSend.status = "SINCRONIZADO";

// ⚠️ se seu schema no Supabase for snake_case, ajuste aqui
// (exemplo: userId -> userid etc). Pelo seu print, parece userId/createdAt/updatedAt iguais ao app.

      const r1 = await supabase
        .from("reports")
        .upsert(reportToSend, { onConflict: "id" });

      const activitiesUnique = dedupeById(activities);
      const pendingsUnique = dedupeById(pendings);

      const r2 = activitiesUnique.length
        ? await supabase.from("activities").upsert(activitiesUnique, { onConflict: "id" })
        : { error: null };
      const r3 = pendingsUnique.length
        ? await supabase.from("pendings").upsert(pendingsUnique, { onConflict: "id" })
        : { error: null };

    if (r1.error || r2.error || r3.error) {
  const err = r1.error || r2.error || r3.error;
  console.error("❌ Erro no sync (completo):", err);
  console.error("❌ Payload report enviado:", reportToSend); // (ver passo 2)
  alert("❌ Erro no sync: " + (err?.message ?? JSON.stringify(err)));
  return;
}


      // ✅ Só após sucesso, refletir status no local
      if (shouldMarkAsSynced) {
        await db.reports.update(job.reportId, { status: "SINCRONIZADO" });
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
  // ✅ dedupe de pendências baixadas para evitar duplicação (ex: ID quebrado no servidor)
  const dedupeDownloadedPendings = (arr: any[]) => {
    const map = new Map<string, any>();
    for (const p of arr) {
      const key = `${p.reportId}::${p.pendingKey ?? p.sourcePendingId ?? p.id}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, p);
        continue;
      }

      // Preferir ID determinístico com '_' (ex: `${reportId}_${pendingKey}`)
      const prevHasUnderscore = String(prev.id ?? "").includes("_");
      const curHasUnderscore = String(p.id ?? "").includes("_");
      if (!prevHasUnderscore && curHasUnderscore) {
        map.set(key, p);
        continue;
      }
      if (prevHasUnderscore && !curHasUnderscore) {
        continue;
      }

      // Desempate: mais recente por createdAt
      const prevTs = String(prev.createdAt ?? "");
      const curTs = String(p.createdAt ?? "");
      if (curTs > prevTs) map.set(key, p);
    }
    return Array.from(map.values());
  };

  const pendingsDeduped = pendings?.length ? dedupeDownloadedPendings(pendings) : [];
  if (pendingsDeduped.length) {
    await db.pendings.bulkPut(pendingsDeduped);

    // ✅ limpeza local: remove duplicatas que já existiam no IndexedDB
    const reportIds = Array.from(new Set(pendingsDeduped.map((p: any) => p.reportId)));
    await db.transaction("rw", db.pendings, async () => {
      for (const rid of reportIds) {
        const allLocal = await db.pendings.where("reportId").equals(rid).toArray();
        const keep = new Map<string, any>();
        const toDelete: string[] = [];

        for (const p of allLocal) {
          const k = `${p.reportId}::${p.pendingKey ?? p.sourcePendingId ?? p.id}`;
          const prev = keep.get(k);
          if (!prev) {
            keep.set(k, p);
            continue;
          }

          const prevHasUnderscore = String(prev.id ?? "").includes("_");
          const curHasUnderscore = String(p.id ?? "").includes("_");

          if (!prevHasUnderscore && curHasUnderscore) {
            toDelete.push(prev.id);
            keep.set(k, p);
            continue;
          }
          if (prevHasUnderscore && !curHasUnderscore) {
            toDelete.push(p.id);
            continue;
          }

          const prevTs = String(prev.createdAt ?? "");
          const curTs = String(p.createdAt ?? "");
          if (curTs > prevTs) {
            toDelete.push(prev.id);
            keep.set(k, p);
          } else {
            toDelete.push(p.id);
          }
        }

        if (toDelete.length) await db.pendings.bulkDelete(toDelete);
      }
    });
  }

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
  finally {
    __isSyncing = false;
  }
}
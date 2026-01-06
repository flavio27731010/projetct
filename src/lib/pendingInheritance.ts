import { db } from "./db";
import { nowISO } from "./utils";

/**
 * Herda pendências abertas para um novo relatório.
 * ✅ Não duplica
 * ✅ Não herda herdadas (evita cascata)
 * ✅ Não herda do próprio relatório novo
 * ✅ 1 pendência por pendingKey no relatório novo
 */
export async function inheritOpenPendings(newReportId: string) {
  // ✅ pega somente pendências abertas que NÃO são herdadas
  // ✅ e ignora pendências do próprio relatório novo (blindagem)
  const openPendings = await db.pendings
    .filter((p) => p.status !== "RESOLVIDO" && p.origin !== "HERDADA" && p.reportId !== newReportId)
    .toArray();

  if (!openPendings.length) return;

  // ✅ pendências que já existem no relatório novo (evita duplicação)
  const existingInNew = await db.pendings.where("reportId").equals(newReportId).toArray();
  const existingKeys = new Set(existingInNew.map((p) => p.pendingKey));

  // ✅ garante 1 por pendingKey (sem repetir)
  const uniqueMap = new Map<string, typeof openPendings[number]>();
  for (const p of openPendings) {
    const key = p.pendingKey ?? p.id;
    if (!uniqueMap.has(key)) uniqueMap.set(key, p);
  }

  const inherited = Array.from(uniqueMap.values())
    .map((p) => {
      const sourceId = p.sourcePendingId ?? p.pendingKey ?? p.id;

      return {
        // ✅ campos essenciais apenas
        id: `${newReportId}_${sourceId}`, // ✅ ID determinístico (evita duplicar)
        pendingKey: sourceId,            // ✅ identidade global
        reportId: newReportId,
        priority: p.priority,
        description: p.description,
        status: "PENDENTE",
        origin: "HERDADA" as const,
        createdAt: nowISO(),

        // ✅ sempre aponta para o original
        sourcePendingId: sourceId,
      };
    })
    .filter((p) => !existingKeys.has(p.pendingKey));

  if (!inherited.length) return;

  // ✅ bulkPut: se já existir, substitui / evita duplicar
  await db.pendings.bulkPut(inherited as any);
}

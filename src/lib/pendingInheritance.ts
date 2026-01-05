import { db } from "./db";
import { nowISO, uuid } from "./utils";

export async function inheritOpenPendings(newReportId: string) {
  // ✅ pega TODAS as pendências do banco
  const allPendings = await db.pendings.toArray();

  // ✅ filtra somente as que ainda estão abertas (não resolvidas)
  const openPendings = allPendings.filter((p) => p.status !== "RESOLVIDO");
  if (!openPendings.length) return;

  // ✅ pega pendências que já existem no relatório novo (para evitar duplicação)
  const existingInNew = await db.pendings.where("reportId").equals(newReportId).toArray();
  const existingKeys = new Set(existingInNew.map((p) => p.pendingKey));

  // ✅ garante que herda APENAS 1 por pendingKey (sem duplicar)
  const uniqueMap = new Map<string, typeof openPendings[number]>();
  for (const p of openPendings) {
    if (!uniqueMap.has(p.pendingKey)) {
      uniqueMap.set(p.pendingKey, p);
    }
  }

  // ✅ cria as cópias herdadas no novo relatório
  const inherited = Array.from(uniqueMap.values())
    .map((p) => {
      const sourceId = p.sourcePendingId ?? p.pendingKey ?? p.id;

      return {
        ...p,
        id: uuid(),
        reportId: newReportId,
        origin: "HERDADA" as const,
        createdAt: nowISO(),

        // ✅ sempre aponta para o original
        sourcePendingId: sourceId,

        // ✅ mantém a identidade global (fundamental)
        pendingKey: sourceId,
      };
    })
    .filter((p) => !existingKeys.has(p.pendingKey)); // ✅ evita duplicação no relatório novo

  if (!inherited.length) return;

  await db.pendings.bulkAdd(inherited);
}

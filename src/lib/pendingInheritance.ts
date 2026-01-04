import { db } from "./db";
import { nowISO, uuid } from "./utils";

export async function inheritOpenPendings(newReportId: string) {
  // ✅ Busca relatórios ordenados por updatedAt (porque createdAt não é indexado no Dexie)
  const reports = await db.reports.orderBy("updatedAt").toArray();

  // ✅ remove o relatório recém-criado
  const previousReports = reports.filter((r) => r.id !== newReportId);

  // ✅ pega o último FINALIZADO
  const previousReport = [...previousReports]
    .reverse()
    .find((r) => r.status === "FINALIZADO");

  // Se não existir finalizado, não herda nada
  if (!previousReport) return;

  // ✅ pega pendências do relatório anterior
  const prevPendings = await db.pendings
    .where("reportId")
    .equals(previousReport.id)
    .toArray();

  // ✅ só herda pendências abertas
  const openPendings = prevPendings.filter((p) => p.status !== "RESOLVIDO");
  if (!openPendings.length) return;

  // ✅ pega pendências que já existem no relatório novo (anti-duplicação)
  const alreadyInNew = await db.pendings
    .where("reportId")
    .equals(newReportId)
    .toArray();

  const existingKeys = new Set(alreadyInNew.map((p) => p.pendingKey));

  // ✅ copia para o novo relatório como HERDADA (sem duplicar)
  const inherited = openPendings
    .map((p) => {
      const sourceId = p.sourcePendingId ?? p.id;
      const pendingKey = p.pendingKey ?? sourceId;

      // ✅ evita duplicação
      if (existingKeys.has(pendingKey)) return null;
      existingKeys.add(pendingKey);

      return {
        ...p,
        id: uuid(),
        reportId: newReportId,
        origin: "HERDADA" as const,
        createdAt: nowISO(),

        // ✅ identidade global (sempre igual ao original)
        pendingKey,

        // ✅ ID original real (para sumir pra sempre quando resolver)
        sourcePendingId: sourceId,
      };
    })
    .filter(Boolean);

  if (!inherited.length) return;

  await db.pendings.bulkAdd(inherited as any);
}

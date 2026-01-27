import { db, type ShiftLetter } from "./db";
import { nowISO } from "./utils";

/**
 * Herda pendências abertas para um novo relatório.
 * ✅ Não duplica
 * ✅ Não herda herdadas (evita cascata)
 * ✅ Não herda do próprio relatório novo
 * ✅ 1 pendência por pendingKey no relatório novo
 * ✅ 3x2 herda SOMENTE pendências do ÚLTIMO 3x2 (A/B)
 * ✅ 4x4 herda SOMENTE pendências do ÚLTIMO 4x4 (A/B/C/D)
 */
export async function inheritOpenPendings(newReportId: string, newReportShiftLetter: ShiftLetter) {
  const newGroup = getGroupFromShiftLetter(newReportShiftLetter); // "3x2" | "4x4"

  // ✅ acha o último relatório do MESMO GRUPO (ignora letra)
  const lastSameGroupReport = await db.reports
  .orderBy("updatedAt")
  .reverse()
  .filter((r) => !r.deletedAt)
  .filter((r) => r.id !== newReportId)
  .filter((r) => getGroupFromShiftLetter(r.shiftLetter) === newGroup)
  .filter((r) => r.status === "SINCRONIZADO")
  .first();


  if (!lastSameGroupReport) return;

  // ✅ pega somente pendências abertas e NÃO herdadas do último report do grupo
  const sourcePendings = await db.pendings
  .where("reportId")
  .equals(lastSameGroupReport.id)
  .filter((p) => p.status !== "RESOLVIDO")
  .toArray();


  if (!sourcePendings.length) return;

  // ✅ pendências que já existem no relatório novo (evita duplicação)
  const existingInNew = await db.pendings.where("reportId").equals(newReportId).toArray();
  const existingKeys = new Set(existingInNew.map((p) => p.pendingKey));

  // ✅ garante 1 por pendingKey (sem repetir)
  const uniqueMap = new Map<string, typeof sourcePendings[number]>();
  for (const p of sourcePendings) {
    const key = p.pendingKey ?? p.id;
    if (!uniqueMap.has(key)) uniqueMap.set(key, p);
  }

  const inherited = Array.from(uniqueMap.values())
    .map((p) => {
      const sourceId = p.sourcePendingId ?? p.pendingKey ?? p.id;

      return {
        id: `${newReportId}_${sourceId}`, // ✅ ID determinístico (não duplica)
        pendingKey: sourceId,            // ✅ identidade global
        reportId: newReportId,
        priority: p.priority,
        description: p.description,
        status: p.status,                // ✅ mantém PENDENTE / EM_ANDAMENTO
        origin: "HERDADA" as const,
        createdAt: nowISO(),

        sourcePendingId: sourceId,       // ✅ aponta pro original
      };
    })
    .filter((p) => !existingKeys.has(p.pendingKey));

  if (!inherited.length) return;

  // ✅ bulkPut evita duplicação caso já exista
  await db.pendings.bulkPut(inherited as any);
}

/**
 * Retorna o grupo do shiftLetter ("3x2" ou "4x4")
 * Ignora letra (A/B/C/D).
 */
function getGroupFromShiftLetter(shiftLetter: ShiftLetter): "3x2" | "4x4" {
  return shiftLetter.startsWith("3x2") ? "3x2" : "4x4";
}

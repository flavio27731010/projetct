import { db, type ShiftLetter } from "./db";
import { nowISO } from "./utils";

/**
 * Herda pendências abertas para um novo relatório.
 * ✅ Não duplica
 * ✅ Não herda herdadas (evita cascata)
 * ✅ Não herda do próprio relatório novo
 * ✅ 1 pendência por pendingKey no relatório novo
 * ✅ 3x2 herda SOMENTE pendências de 3x2 (A e B)
 * ✅ 4x4 herda SOMENTE pendências de 4x4 (A, B, C, D)
 */
export async function inheritOpenPendings(newReportId: string, newReportShiftLetter: ShiftLetter) {
  const newGroup = getGroupFromShiftLetter(newReportShiftLetter); // "3x2" | "4x4"

  // ✅ pega somente pendências abertas, NÃO herdadas e não do próprio report
  const openPendings = await db.pendings
    .filter((p) => p.status !== "RESOLVIDO" && p.origin !== "HERDADA" && p.reportId !== newReportId)
    .toArray();

  if (!openPendings.length) return;

  // ✅ pega reportIds únicos dessas pendências
  const reportIds = Array.from(new Set(openPendings.map((p) => p.reportId)));

  // ✅ carrega todos reports de uma vez
  const sourceReports = await db.reports.bulkGet(reportIds);

  // ✅ monta map reportId -> grupo
  const reportGroupMap = new Map<string, "3x2" | "4x4">();
  for (const r of sourceReports) {
    if (!r) continue;
    reportGroupMap.set(r.id, getGroupFromShiftLetter(r.shiftLetter));
  }

  // ✅ filtra pendências do mesmo grupo do novo relatório
  const sameGroupPendings = openPendings.filter((p) => reportGroupMap.get(p.reportId) === newGroup);

  if (!sameGroupPendings.length) return;

  // ✅ pendências que já existem no relatório novo (evita duplicação)
  const existingInNew = await db.pendings.where("reportId").equals(newReportId).toArray();
  const existingKeys = new Set(existingInNew.map((p) => p.pendingKey));

  // ✅ garante 1 por pendingKey (sem repetir)
  const uniqueMap = new Map<string, typeof sameGroupPendings[number]>();
  for (const p of sameGroupPendings) {
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
 */
function getGroupFromShiftLetter(shiftLetter: ShiftLetter): "3x2" | "4x4" {
  return shiftLetter.startsWith("3x2") ? "3x2" : "4x4";
}

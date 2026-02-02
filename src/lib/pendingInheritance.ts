import { db, type ShiftLetter } from "./db";
import { nowISO } from "./utils";

/**
 * Herda pendências abertas para um novo relatório.
 * ✅ Não duplica
 * ✅ Evita “cascata”/duplicação usando uma identidade raiz (sourcePendingId/pendingKey)
 * ✅ Não herda do próprio relatório novo
 * ✅ 1 pendência por pendingKey no relatório novo
 * ✅ 3x2: herda pendências abertas do ÚLTIMO 3x2 A e do ÚLTIMO 3x2 B
 * ✅ 4x4: herda pendências abertas do ÚLTIMO 4x4 A/B/C/D
 */
export async function inheritOpenPendings(newReportId: string, newReportShiftLetter: ShiftLetter) {
  const newGroup = getGroupFromShiftLetter(newReportShiftLetter); // "3x2" | "4x4"

  /**
   * Regras desejadas (mobile/PWA):
   * - 3x2: herdar pendências abertas de 3x2 A **e** 3x2 B
   * - 4x4: herdar pendências abertas de 4x4 A/B/C/D
   *
   * Para não “perder” pendências (ficarem para trás), pegamos o ÚLTIMO relatório
   * SINCRONIZADO de cada letra e unimos as pendências abertas.
   */
  const letters: Array<"A" | "B" | "C" | "D"> = newGroup === "3x2" ? ["A", "B"] : ["A", "B", "C", "D"];

  // ✅ pega o último relatório SINCRONIZADO de cada letra dentro do grupo
  const sourceReportIds: string[] = [];
  for (const letter of letters) {
    const shiftLetter = `${newGroup} ${letter}` as ShiftLetter;

    const candidates = await db.reports
      .where("shiftLetter")
      .equals(shiftLetter)
      .filter((r) => !r.deletedAt)
      .filter((r) => r.id !== newReportId)
      .filter((r) => r.status === "SINCRONIZADO")
      .sortBy("updatedAt");

    const last = candidates.at(-1);
    if (last) sourceReportIds.push(last.id);
  }

  if (!sourceReportIds.length) return;

  // ✅ pendências abertas (de todas as letras relevantes)
  const sourcePendings = (
    await Promise.all(
      sourceReportIds.map((rid) =>
        db.pendings
          .where("reportId")
          .equals(rid)
          .filter((p) => p.status !== "RESOLVIDO")
          .toArray()
      )
    )
  ).flat();

  if (!sourcePendings.length) return;

  // ✅ pendências que já existem no relatório novo (evita duplicação)
  const existingInNew = await db.pendings.where("reportId").equals(newReportId).toArray();
  const existingKeys = new Set(existingInNew.map((p) => p.pendingKey));

  // ✅ garante 1 por pendingKey (sem repetir)
  const uniqueMap = new Map<string, typeof sourcePendings[number]>();
  for (const p of sourcePendings) {
    // ✅ usa sempre a “raiz” para evitar duplicações (mesmo que já seja HERDADA)
    const key = p.sourcePendingId ?? p.pendingKey ?? p.id;
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

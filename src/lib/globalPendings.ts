import { db } from "./db";
import { nowISO, uuid } from "./utils";

export async function inheritOpenPendings(newReportId: string) {
  const reports = await db.reports.orderBy("createdAt").toArray();

  const previousReports = reports.filter((r) => r.id !== newReportId);

  const previousReport = [...previousReports]
    .reverse()
    .find((r) => r.status === "FINALIZADO");

  if (!previousReport) return;

  const prevPendings = await db.pendings
    .where("reportId")
    .equals(previousReport.id)
    .toArray();

  // ✅ só herda pendências abertas
  const openPendings = prevPendings.filter((p) => p.status !== "RESOLVIDO");
  if (!openPendings.length) return;

  const inherited = openPendings.map((p) => ({
    ...p,
    id: uuid(),
    reportId: newReportId,
    origin: "HERDADA" as const,
    createdAt: nowISO(),

    // ✅ ID original real (para sumir pra sempre quando resolver)
    sourcePendingId: p.sourcePendingId ?? p.id,
  }));

  await db.pendings.bulkAdd(inherited);
}

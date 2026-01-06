import type { Activity, Pending, Report } from "./db";
import { formatDateBR, priorityOrder } from "./utils";

export async function generateReportPDF(report: Report, activities: Activity[], pendings: Pending[]) {
  // ✅ LAZY LOAD
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF();

  doc.setFontSize(14);
  doc.text(`RDO - Relatório de Turno`, 14, 18);

  doc.setFontSize(11);
  doc.text(
    `Data: ${formatDateBR(report.date)} | Turno: ${report.shift} | Letra: ${(report as any).shiftLetter ?? "-"}`,
    14,
    26
  );
  doc.text(`Assinatura: ${report.signatureName || "-"}`, 14, 33);
  doc.text(`Status: ${report.status}`, 14, 40);

  // ✅ atividades
  doc.setFontSize(12);
  doc.text("Atividades Realizadas", 14, 52);

  autoTable(doc, {
    startY: 56,
    head: [["Hora", "Descrição"]],
    body: activities
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((a) => [a.time, a.description]),
  });

  // ✅ pendências separadas
  const pendentes = pendings
    .filter((p) => p.status !== "RESOLVIDO")
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const resolvidas = pendings
    .filter((p) => p.status === "RESOLVIDO")
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  let y = (doc as any).lastAutoTable.finalY + 12;

  doc.setFontSize(12);
  doc.text("Pendências / Em Andamento", 14, y);

  autoTable(doc, {
    startY: y + 4,
    head: [["Prioridade", "Origem", "Descrição", "Status"]],
    body: pendentes.map((p) => [p.priority, p.origin, p.description, p.status]),
  });

  y = (doc as any).lastAutoTable.finalY + 12;

  doc.setFontSize(12);
  doc.text("Pendências Resolvidas neste Turno", 14, y);

  autoTable(doc, {
    startY: y + 4,
    head: [["Prioridade", "Origem", "Descrição", "Status"]],
    body: resolvidas.map((p) => [p.priority, p.origin, p.description, p.status]),
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 3) {
        const statusText = String(data.cell.text?.[0] ?? "").toUpperCase();
        if (statusText === "RESOLVIDO") {
          data.cell.styles.textColor = [0, 80, 0];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  // ✅ nome do arquivo
  const filename = `RDO_${report.shift}_${formatDateBR(report.date)}.pdf`;

  // ✅ retorna o pdf como Blob
  const blob = doc.output("blob");

  return { blob, filename };
}

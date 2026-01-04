import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Activity, Pending, Report } from "./db";
import { formatDateBR, formatShift } from "./utils";

export function generateReportPDF(
  report: Report,
  activities: Activity[],
  pendings: Pending[]
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // ====== CABEÇALHO MELHORADO (mínimas mudanças) ======
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("RELATÓRIO DE TURNO (RDO)", pageWidth / 2, 16, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Data: ${formatDateBR(report.date)}`, 14, 26);
  doc.text(`Turno: ${formatShift(report.shift)}`, 14, 33);

  // ✅ Se existir scale no report, mostra no PDF (não quebra TS)
  if ((report as any).scale) {
    doc.text(`Escala: ${(report as any).scale}`, 14, 40);
    doc.text(`Responsável (assinatura): ${report.signatureName}`, 14, 47);
  } else {
    doc.text(`Responsável (assinatura): ${report.signatureName}`, 14, 40);
  }

  // ✅ Se existir status no report, mostra no canto direito
  if ((report as any).status) {
    doc.text(`Status: ${(report as any).status}`, pageWidth - 14, 26, {
      align: "right",
    });
  }

  // Linha separadora (ajustada)
  doc.setDrawColor(80);
  const headerLineY = (report as any).scale ? 52 : 44;
  doc.line(14, headerLineY, 196, headerLineY);

  // ====== ATIVIDADES ======
  const startActivitiesY = (report as any).scale ? 62 : 54;

  doc.setFontSize(13);
  doc.text("Atividades Realizadas", 14, startActivitiesY);

  const actRows = activities
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((a) => [a.time, a.description]);

  autoTable(doc, {
    startY: startActivitiesY + 4,
    head: [["Hora", "Descrição"]],
    body: actRows.length ? actRows : [["-", "Nenhuma atividade registrada."]],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [17, 24, 39] },
    theme: "grid",
  });

  // ====== PENDÊNCIAS ======
  const afterActsY = (doc as any).lastAutoTable.finalY + 10;
  doc.setFontSize(13);
  doc.text("Pendências para o Próximo Turno", 14, afterActsY);

  const inherited = pendings.filter((p) => p.origin === "HERDADA");
  const news = pendings.filter((p) => p.origin === "NOVA");

  const pendRows = [
    ...(inherited.length
      ? inherited.map((p) => ["HERDADA", p.priority, p.description, p.status])
      : [["HERDADA", "-", "Nenhuma", "-"]]),
    ...(news.length
      ? news.map((p) => ["NOVA", p.priority, p.description, p.status])
      : [["NOVA", "-", "Nenhuma", "-"]]),
  ];

  autoTable(doc, {
    startY: afterActsY + 4,
    head: [["Origem", "Prioridade", "Descrição", "Status"]],
    body: pendRows.length
      ? pendRows
      : [["-", "-", "Nenhuma pendência registrada.", "-"]],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [17, 24, 39] },
    theme: "grid",

    // ✅ RESOLVIDO em verde escuro (mínima modificação)
    didParseCell: (data) => {
      if (data.section === "body") {
        const raw = data.row.raw as any[];
const statusText = String(raw?.[3] ?? "").toUpperCase();

        if (statusText === "RESOLVIDO") {
          data.cell.styles.textColor = [0, 80, 0]; // ✅ verde escuro
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  // ====== RODAPÉ ======
  const afterPendY = (doc as any).lastAutoTable.finalY + 14;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Emitido em: ${new Date().toLocaleString()}`, 14, afterPendY);

  // Nome do arquivo (mantido igual, opcional: incluir escala)
  doc.save(`RDO_${formatDateBR(report.date)}_${report.shift}_${report.shiftLetter}.pdf`);
}

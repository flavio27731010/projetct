import type { Activity, Pending, Report } from "./db";
import { formatDateBR, priorityOrder } from "./utils";

export async function generateReportPDF(report: Report, activities: Activity[], pendings: Pending[]) {
  const is3x2 = report.shiftLetter.startsWith("3x2");

  const theme = is3x2
    ? {
        mode: "3x2" as const,
        primary: [0, 80, 130] as [number, number, number], // ✅ azul forte
        light: [235, 244, 255] as [number, number, number],
        title: "Relatório de Turno (3x2)",
        filePrefix: "RDO_3x2",
      }
    : {
        mode: "4x4" as const,
        primary: [0, 40, 130] as [number, number, number], // ✅ cinza moderno
        light: [245, 245, 245] as [number, number, number],
        title: "Relatório de Turno (4x4)",
        filePrefix: "RDO_4x4",
      };

  return generateModernPDF(report, activities, pendings, theme);
}

async function generateModernPDF(
  report: Report,
  activities: Activity[],
  pendings: Pending[],
  theme: {
    mode: "3x2" | "4x4";
    primary: [number, number, number];
    light: [number, number, number];
    title: string;
    filePrefix: string;
  }
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const letterOnly = report.shiftLetter.split(" ")[1] ?? "-";
  const safeDate = formatDateBR(report.date).replaceAll("/", "-");

  /* ================= HEADER MODERNO ================= */
  doc.setFillColor(...theme.primary);
  doc.rect(0, 0, pageWidth, 28, "F");

  // ✅ título centralizado
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(theme.title, pageWidth / 2, 18, { align: "center" });

  // ✅ subtítulo centralizado
  doc.setFontSize(10);
  doc.text(`Gerado automaticamente • ${safeDate}`, pageWidth / 2, 24, { align: "center" });

  /* ================= CARDS DE INFO (4 EM UMA LINHA) ================= */
  const cardY = 34;
  const cardH = 18;
  const gap = 4;
  const marginX = 14;

  const cardW = (pageWidth - marginX * 2 - gap * 3) / 4;

  function drawCard(x: number, y: number, title: string, value: string) {
    doc.setFillColor(...theme.light);
    doc.roundedRect(x, y, cardW, cardH, 3, 3, "F");

    doc.setTextColor(70, 70, 70);
    doc.setFontSize(8);
    doc.text(title, x + 3, y + 6);

    doc.setTextColor(10, 10, 10);
    doc.setFontSize(10);

    const maxChars = 22;
    const textValue = value.length > maxChars ? value.slice(0, maxChars - 2) + "…" : value;

    doc.text(textValue, x + 3, y + 14);
  }

  // ✅ Ordem: Responsável → Data → Letra → Turno
  drawCard(marginX + (cardW + gap) * 0, cardY, "Responsável", report.signatureName || "-");
  drawCard(marginX + (cardW + gap) * 1, cardY, "Data", formatDateBR(report.date));
  drawCard(marginX + (cardW + gap) * 2, cardY, "Letra", `${theme.mode} ${letterOnly}`);
  drawCard(marginX + (cardW + gap) * 3, cardY, "Turno", report.shift);

  /* ================= HELPERS ================= */
  function sectionTitle(text: string, y: number) {
    doc.setTextColor(...theme.primary);
    doc.setFontSize(12);
    doc.text(text, 14, y);
  }

  // ✅ colorir Status: PENDENTE vermelho, RESOLVIDO verde, EM_ANDAMENTO laranja
  function applyStatusColor(data: any, statusColumnIndex: number) {
    if (data.section !== "body") return;
    if (data.column.index !== statusColumnIndex) return;

    const statusText = String(data.cell.text?.[0] ?? "").toUpperCase().trim();

    if (statusText === "PENDENTE") {
      data.cell.styles.textColor = [180, 0, 0]; // ✅ vermelho
      data.cell.styles.fontStyle = "bold";
    }

    if (statusText === "RESOLVIDO") {
      data.cell.styles.textColor = [0, 120, 0]; // ✅ verde
      data.cell.styles.fontStyle = "bold";
    }

    if (statusText === "EM_ANDAMENTO") {
      data.cell.styles.textColor = [200, 120, 0]; // ✅ laranja (opcional)
      data.cell.styles.fontStyle = "bold";
    }
  }

  /* ================= ATIVIDADES ================= */
  let y = cardY + cardH + 18;

  sectionTitle("Atividades Realizadas", y);

  autoTable(doc, {
    startY: y + 4,
    head: [["Hora", "Descrição"]],
    body: activities
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((a) => [a.time, a.description]),
    styles: {
      fontSize: 10,
      cellPadding: 3,
      valign: "middle",
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
  });

  /* ================= PENDÊNCIAS ================= */
  const pendentes = pendings
    .filter((p) => p.status !== "RESOLVIDO")
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const resolvidas = pendings
    .filter((p) => p.status === "RESOLVIDO")
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  y = (doc as any).lastAutoTable.finalY + 12;
  sectionTitle("Pendências", y);

  autoTable(doc, {
    startY: y + 4,
    head: [["Prioridade", "Origem", "Descrição", "Status"]],
    body: pendentes.map((p) => [p.priority, p.origin, p.description, p.status]),
    styles: {
      fontSize: 10,
      cellPadding: 3,
      valign: "middle",
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
    didParseCell: (data) => applyStatusColor(data, 3), // ✅ coluna Status = 3
  });

  y = (doc as any).lastAutoTable.finalY + 12;
  sectionTitle("Pendências Resolvidas no turno", y);

  autoTable(doc, {
    startY: y + 4,
    head: [["Prioridade", "Origem", "Descrição", "Status"]],
    body: resolvidas.map((p) => [p.priority, p.origin, p.description, p.status]),
    styles: {
      fontSize: 10,
      cellPadding: 3,
      valign: "middle",
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
    didParseCell: (data) => applyStatusColor(data, 3), // ✅ coluna Status = 3
  });

  /* ================= RODAPÉ COM PÁGINA ================= */
  const pages = doc.getNumberOfPages();

  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const footerY = pageHeight - 10;

    doc.setTextColor(120, 120, 120);
    doc.setFontSize(9);

    doc.text(`RDO ${theme.mode.toUpperCase()} • ${safeDate} • Página ${i}/${pages}`, 14, footerY);
  }

  const filename = `${theme.filePrefix}_${letterOnly}_${safeDate}.pdf`;
  const blob = doc.output("blob");

  return { blob, filename };
}

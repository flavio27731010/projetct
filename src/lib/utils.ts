import type { Pending } from "./db";

export function uuid() {
  return crypto.randomUUID();
}

export function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function nowISO() {
  return new Date().toISOString();
}

export function nowHHmm() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function formatDateBR(isoDate: string) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export function shiftTimes(shift: "DIURNO" | "NOTURNO") {
  return shift === "DIURNO"
    ? { startTime: "07:00", endTime: "19:00" }
    : { startTime: "19:00", endTime: "07:00" };
}

export function formatShift(shift: "DIURNO" | "NOTURNO") {
  return shift === "DIURNO" ? "Diurno (07:00–19:00)" : "Noturno (19:00–07:00)";
}

// ✅ contagem de pendências por status
export function countPendings(pendings: Pending[]) {
  return {
    abertas: pendings.filter((p) => p.status !== "RESOLVIDO").length,
    resolvidas: pendings.filter((p) => p.status === "RESOLVIDO").length,
  };
}

// ✅ ordenação por prioridade
export const priorityOrder: Record<Pending["priority"], number> = {
  URGENTE: 1,
  ALTA: 2,
  MEDIA: 3,
  BAIXA: 4,
};

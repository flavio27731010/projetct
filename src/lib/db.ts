import Dexie from "dexie";
import type { Table } from "dexie";

export type Shift = "DIURNO" | "NOTURNO";

// ✅ agora aceita 4x4 e 3x2
export type ShiftLetter =
  | "4x4 A"
  | "4x4 B"
  | "4x4 C"
  | "4x4 D"
  | "3x2 A"
  | "3x2 B";

export type ReportStatus = "RASCUNHO" | "FINALIZADO" | "SINCRONIZADO";

export type Report = {
  id: string;
  userId: string;
  date: string;
  shift: Shift;
  shiftLetter: ShiftLetter;
  startTime: string;
  endTime: string;
  signatureName: string;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  syncVersion: number;
};

export type Activity = {
  id: string;
  reportId: string;
  time: string;
  description: string;
  createdAt: string;
};

export type Pending = {
  id: string;
  pendingKey: string; // ✅ identidade global da pendência (não muda entre turnos)

  reportId: string;
  priority: "BAIXA" | "MEDIA" | "ALTA" | "URGENTE";
  description: string;
  status: "PENDENTE" | "EM_ANDAMENTO" | "RESOLVIDO";
  origin: "HERDADA" | "NOVA";
  createdAt: string;

  sourcePendingId?: string; // ✅ aponta para a pendência original
};

export type SyncQueueItem = {
  id: string;
  type: "UPSERT_REPORT" | "DELETE_REPORT";
  reportId: string;
  createdAt: string;
};

class AppDB extends Dexie {
  reports!: Table<Report, string>;
  activities!: Table<Activity, string>;
  pendings!: Table<Pending, string>;
  syncQueue!: Table<SyncQueueItem, string>;

  constructor() {
    super("rdo_db");

    this.version(2)
      .stores({
        reports: "id, userId, date, shift, shiftLetter, status, updatedAt",
        activities: "id, reportId, createdAt",
        pendings: "id, pendingKey, reportId, [reportId+pendingKey], createdAt",
        syncQueue: "id, type, reportId, createdAt",
      })
      .upgrade(async (tx) => {
        // ✅ Migração automática: pendências antigas ganham pendingKey = id
        const pendings = await tx.table("pendings").toArray();
        for (const p of pendings) {
          if (!("pendingKey" in p)) {
            await tx.table("pendings").update(p.id, { pendingKey: p.id });
          }
        }
      });
  }
}

export const db = new AppDB();

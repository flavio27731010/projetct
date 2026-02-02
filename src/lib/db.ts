import Dexie from "dexie";
import type { Table } from "dexie";

export type Shift = "DIURNO" | "NOTURNO";
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

  deletedAt?: string | null; // ✅ SOFT DELETE GLOBAL
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
  pendingKey: string;

  reportId: string;
  priority: "BAIXA" | "MEDIA" | "ALTA" | "URGENTE";
  description: string;
  status: "PENDENTE" | "EM_ANDAMENTO" | "RESOLVIDO";
  origin: "HERDADA" | "NOVA";
  createdAt: string;

  sourcePendingId?: string;
  deletedAt?: string | null; // ✅ SOFT DELETE (não herda nem imprime)
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

    // ✅ Atualizou version para incluir deletedAt no reports
    this.version(4)
      .stores({
        reports: "id, userId, date, shift, shiftLetter, status, updatedAt, deletedAt",
        activities: "id, reportId, createdAt",
        pendings: "id, pendingKey, reportId, createdAt, deletedAt",
        syncQueue: "id, type, reportId, createdAt",
      })
      .upgrade(async (tx) => {
        // ✅ Migração: pendências antigas ganham pendingKey = id (se faltar)
        const pendings = await tx.table("pendings").toArray();
        for (const p of pendings) {
          if (!("pendingKey" in p)) {
            await tx.table("pendings").update(p.id, { pendingKey: p.id });
          }
        }

        
        // ✅ Migração: pendências antigas ganham deletedAt = null (se faltar)
        for (const p of pendings) {
          if (!("deletedAt" in p)) {
            await tx.table("pendings").update(p.id, { deletedAt: null });
          }
        }

// ✅ Migração: reports antigos ganham deletedAt = null (se faltar)
        const reports = await tx.table("reports").toArray();
        for (const r of reports) {
          if (!("deletedAt" in r)) {
            await tx.table("reports").update(r.id, { deletedAt: null });
          }
        }
      });
  }
}

export const db = new AppDB();

import { requireSession } from "./authService";
import { assertScope, withTransaction } from "./database";

export type TeacherNotification = {
  id: string;
  type: "learning_change" | "missed_entry" | "system";
  title: string;
  body: string;
  grade: number | null;
  concept_id: string | null;
  read_at: string | null;
  created_at: string;
};

export async function listNotifications(): Promise<TeacherNotification[]> {
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    return tx.getAllAsync<TeacherNotification>("SELECT id,type,title,body,grade,concept_id,read_at,created_at FROM notifications WHERE workspace_id=? ORDER BY created_at DESC LIMIT 50", session.workspaceId);
  });
}

export async function markNotificationRead(id: string) {
  const session = await requireSession();
  await withTransaction(async tx => {
    await assertScope(tx, session);
    await tx.runAsync("UPDATE notifications SET read_at=? WHERE workspace_id=? AND id=?", new Date().toISOString(), session.workspaceId, id);
  });
}

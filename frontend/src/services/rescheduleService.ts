import { requireSession } from "./authService";
import { newId, repository } from "./database";
import type { RescheduleAction } from "@/types/chat";

export type SavedReschedulePlan = RescheduleAction & {
  kind: "reschedule-plan"; version: 1; id: string; createdAt: string;
  workspaceId: string; teacherId: string;
};

export async function applyReschedulePlan(action: RescheduleAction): Promise<SavedReschedulePlan> {
  const session = await requireSession();
  if (!action.grades.length || !action.leave_day_tasks.length || !action.rescheduled_slots.length) {
    throw new Error("This reschedule proposal is incomplete.");
  }
  const plan: SavedReschedulePlan = {
    ...action, kind: "reschedule-plan", version: 1, id: newId(), createdAt: new Date().toISOString(),
    workspaceId: session.workspaceId, teacherId: session.teacherId,
  };
  await repository("schedules", session).save({ data: JSON.stringify(plan) }, plan.id);
  return plan;
}

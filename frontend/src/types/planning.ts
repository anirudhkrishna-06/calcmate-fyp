import { Grade } from "./domain";
import { StudentRecord, AttendanceRecord, AssessmentRecord, CompetencyRecord, ConceptRecord } from "@/services/database";
export type PlanningSelection = { grade:Grade; subject:"Math"; date:string; availableMinutes:number };
export type PlanningPayload = {
  version:1; localRevision?:number; workspaceId:string; teacherId:string; selection:PlanningSelection;
  students:StudentRecord[]; attendance:AttendanceRecord[]; assessments:AssessmentRecord[];
  competencies:CompetencyRecord[]; concepts:ConceptRecord[];
};
export type PlanningSummary = {
  students:number; eligible:number; absent:number; attendanceRecorded:number;
  assessmentCount:number; competencyCount:number; studentsWithAssessments:number;
  weakConcepts:{ id:string; title:string; students:number }[]; missing:string[];
};
export type Lesson = {
  order:number; conceptId:string | null; title:string; durationMinutes:number;
  objective:string; activities:string[]; reasons:string[]; studentIds:string[];
  status?:"planned"|"completed"|"partial"|"postponed";
};
export type ScheduleDraft = {
  engine:string; label:"DEMO/MOCK" | "ENGINE"; selection:PlanningSelection;
  summary:PlanningSummary; lessons:Lesson[];
};
export type SavedPlan = ScheduleDraft & { kind:"lesson-plan"; version:1; id:string; createdAt:string; payload:PlanningPayload };
export interface SchedulingEngine { generate(payload:PlanningPayload):Promise<ScheduleDraft> }

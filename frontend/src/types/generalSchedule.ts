import type { Grade } from './domain';
export type GeneralSelection = { date:string; availableMinutes:number; grades:Grade[]; priority:'balanced'|'learning-needs' };
export type GradeNeed = { grade:Grade; students:number; attending:number; missing:number; weak:number; prerequisiteGap:boolean; conceptId:string|null; concept:string; objective:string; weight:number; reason:string };
export type RotationActivity = { grade:Grade; concept:string; objective:string; activity:string };
export type RotationBlock = { id:string; kind:'opening'|'instruction'|'transition'|'closing'; durationMinutes:number; teacherGrade:Grade|null; teacherActivity:string; activities:RotationActivity[]; reason:string; status:'planned'|'completed'|'postponed' };
export type GeneralDraft = { kind:'general-schedule'; version:1; selection:GeneralSelection; needs:GradeNeed[]; warnings:string[]; blocks:RotationBlock[] };
export type GeneralSchedule = GeneralDraft & { id:string; createdAt:string; workspaceId:string; teacherId:string };

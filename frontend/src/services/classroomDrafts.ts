import { AttendanceRecord } from "./database";
export type AttendanceDraft={date:string;changes:Record<string,AttendanceRecord["status"]>};
export type MarksDraft={concept:string;date:string;maximum:string;marks:Record<string,string>};
function calendarDate(value:unknown):value is string {
  return typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value);}
export function recoverAttendanceDraft(value:unknown):value is AttendanceDraft {
  if(!record(value)||!calendarDate(value.date)||!record(value.changes))return false;
  const statuses=Object.values(value.changes);
  return statuses.length>0 && statuses.every(status=>["present","absent","late"].includes(String(status)));
}
export function recoverMarksDraft(value:unknown):value is MarksDraft {
  if(!record(value)||!calendarDate(value.date)||typeof value.concept!=="string"||typeof value.maximum!=="string"||!record(value.marks))return false;
  const marks=Object.values(value.marks);
  return marks.every(mark=>typeof mark==="string"&&mark.length<=16)&&marks.some(mark=>String(mark).trim()!=="");
}

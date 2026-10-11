import { PlanningPayload, PlanningSelection, PlanningSummary, ScheduleDraft, Lesson } from "@/types/planning";

export function validatePlanningSelection(selection:PlanningSelection) {
  if (![1,2,3,4].includes(selection.grade) || selection.subject !== "Math") throw new Error("Choose a Grade 1-4 Maths class.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selection.date) || !Number.isFinite(Date.parse(selection.date)) || new Date(selection.date).toISOString().slice(0,10) !== selection.date) throw new Error("Enter a valid planning date (YYYY-MM-DD).");
  if (!Number.isInteger(selection.availableMinutes) || selection.availableMinutes < 20 || selection.availableMinutes > 240) throw new Error("Choose 20 to 240 whole minutes.");
}
export function eligibleStudents(payload:PlanningPayload) {
  const absent = new Set(payload.attendance.filter(a => a.date === payload.selection.date && a.status === "absent").map(a => a.student_id));
  return payload.students.filter(s => !absent.has(s.id)).sort((a,b) => a.id.localeCompare(b.id));
}
// Use the lower of teacher competency and latest assessment when both exist.
export function conceptEvidence(payload:PlanningPayload, studentId:string, conceptId:string):number | null {
  const competency = payload.competencies.find(c => c.student_id === studentId && c.concept_id === conceptId);
  const assessment = payload.assessments.filter(a => a.student_id === studentId && a.concept_id === conceptId)
    .sort((a,b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
  const values = [competency?.mastery,assessment ? assessment.score/assessment.maximum : undefined].filter((v):v is number => v !== undefined);
  return values.length ? Math.min(...values) : null;
}
function relevantConcepts(payload:PlanningPayload) {
  const found = new Set<string>(); const visiting = new Set<string>();
  const visit = (id:string) => {
    if (visiting.has(id)) throw new Error("Maths prerequisite rules contain a cycle.");
    if (found.has(id)) return;
    const concept = payload.concepts.find(c => c.id === id);
    if (!concept) throw new Error("A prerequisite concept is missing from local records.");
    visiting.add(id); if (concept.prerequisite_id) visit(concept.prerequisite_id);
    visiting.delete(id); found.add(id);
  };
  payload.concepts.filter(c => c.grade === payload.selection.grade).sort((a,b) => a.id.localeCompare(b.id)).forEach(c => visit(c.id));
  return [...found].map(id => payload.concepts.find(c => c.id === id)!);
}
export function summarizePlanning(payload:PlanningPayload):PlanningSummary {
  const eligible = eligibleStudents(payload); const concepts = relevantConcepts(payload);
  const recorded = new Set(payload.attendance.filter(a => a.date === payload.selection.date).map(a => a.student_id));
  const assessed = new Set(payload.assessments.map(a => a.student_id));
  const missing = [];
  if (payload.students.length !== recorded.size) missing.push(`${payload.students.length-recorded.size} students have no attendance entry on the planning date; attendance is not assumed.`);
  if (payload.students.length !== assessed.size) missing.push(`${payload.students.length-assessed.size} students have no assessment evidence as of the planning date.`);
  const unknown = concepts.filter(c => eligible.some(s => conceptEvidence(payload,s.id,c.id) === null));
  if (unknown.length) missing.push(`Missing concept evidence: ${unknown.map(c => c.title).join(", ")}. Start with readiness checks.`);
  if (!concepts.length) missing.push("No Maths concepts are configured for this grade.");
  if (!eligible.length) missing.push("No students are available for this plan.");
  return {
    students:payload.students.length,eligible:eligible.length,absent:payload.students.length-eligible.length,attendanceRecorded:recorded.size,
    assessmentCount:payload.assessments.length,competencyCount:payload.competencies.length,studentsWithAssessments:assessed.size,
    weakConcepts:concepts.map(c => ({id:c.id,title:c.title,students:eligible.filter(s => {const v=conceptEvidence(payload,s.id,c.id);return v!==null && v<0.6;}).length})).filter(c => c.students>0),missing
  };
}
export function generateMockPlan(payload:PlanningPayload):ScheduleDraft {
  validatePlanningSelection(payload.selection);
  const students = eligibleStudents(payload); const concepts = relevantConcepts(payload);
  const targets = concepts.filter(c => c.grade === payload.selection.grade);
  if (!students.length) throw new Error("Add students or review recorded absences before generating a plan.");
  if (!targets.length) throw new Error("No local Maths concepts are available for this grade.");
  const lessons:Lesson[] = [];
  for (const concept of concepts) {
    const weak = students.filter(s => { const value=conceptEvidence(payload,s.id,concept.id); return value!==null && value<0.6; });
    const unknown = students.filter(s => conceptEvidence(payload,s.id,concept.id) === null);
    const target = concept.grade === payload.selection.grade;
    if (!target && !weak.length && !unknown.length) continue;
    const dependents = concepts.filter(c => c.prerequisite_id === concept.id).map(c => c.title);
    const reasons = [
      ...(weak.length ? [`${weak.length} students have recorded evidence below 60% in ${concept.title}.`] : []),
      ...(unknown.length ? [`${unknown.length} students lack evidence; check readiness before assuming mastery.`] : []),
      ...(dependents.length ? [`${concept.title} is a prerequisite for ${dependents.join(", ")}; address it first.`] : []),
      ...(!weak.length && !unknown.length ? ["Recorded evidence meets the 60% practice threshold."] : [])
    ];
    lessons.push({
      order:lessons.length+1,conceptId:concept.id,title:`${weak.length ? "Revision" : unknown.length ? "Readiness check" : "Guided practice"}: ${concept.title}`,
      durationMinutes:0,objective:`Students demonstrate ${concept.title.toLowerCase()} using examples and explain their reasoning.`,
      activities:[conceptActivity(concept.id),
        weak.length ? "Work with the revision group using concrete examples, then try a similar question independently." : "Use paired practice; check students with missing evidence individually.",
        "Record a short concept assessment before moving on."],
      reasons,studentIds:(target ? students : [...weak,...unknown]).map(s => s.id).sort()
    });
  }
  lessons.push({ order:lessons.length+1,conceptId:null,title:"Exit check",durationMinutes:5,
    objective:"Check readiness for the next lesson.",activities:["Ask one short question per taught concept.","Record results and a teacher observation."],
    reasons:["New evidence should guide the next plan; missing data is not treated as low performance."],studentIds:students.map(s => s.id) });
  const count = lessons.length-1; const minutes = payload.selection.availableMinutes-5;
  if (minutes < count*5) throw new Error(`Allow at least ${count*5+5} minutes for these prerequisite and lesson blocks.`);
  lessons.slice(0,-1).forEach((lesson,i) => { lesson.durationMinutes=Math.floor(minutes/count)+(i<minutes%count ? 1 : 0); });
  return { engine:"mock-v1",label:"DEMO/MOCK",selection:{...payload.selection},summary:summarizePlanning(payload),lessons };
}

function conceptActivity(conceptId:string):string {
  const activities:Record<string,string> = {
    count:"Count a set of counters, then match the count to a written numeral.",
    add:"Combine two groups of counters and explain addition on a number line.",
    place:"Bundle sticks into tens and ones; read and build two-digit numbers.",
    subtract:"Use tens-and-ones bundles to demonstrate exchanging a ten before subtraction.",
    multiply:"Arrange counters in equal rows; connect repeated addition to multiplication facts.",
    divide:"Share counters equally into groups; check the result with a multiplication fact.",
    fractions:"Fold equal-sized paper strips into halves and quarters; compare equivalent parts.",
    measure:"Measure a classroom object and add side lengths to find its perimeter."
  };
  return activities[conceptId] ?? "Model one example with counters, drawings or a number line.";
}

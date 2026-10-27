import { computeMasteryEstimate } from "./learnerEstimator";
import { PlanningPayload, PlanningSelection, PlanningSummary, ScheduleDraft, Lesson } from "@/types/planning";

export function validatePlanningSelection(selection:PlanningSelection) {
  if (![1,2,3,4,5].includes(selection.grade) || selection.subject !== "Math") throw new Error("Choose a Grade 1-5 Maths class.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selection.date) || !Number.isFinite(Date.parse(selection.date)) || new Date(selection.date).toISOString().slice(0,10) !== selection.date) throw new Error("Enter a valid planning date (YYYY-MM-DD).");
  if (!Number.isInteger(selection.availableMinutes) || selection.availableMinutes < 20 || selection.availableMinutes > 240) throw new Error("Choose 20 to 240 whole minutes.");
}
export function eligibleStudents(payload:PlanningPayload) {
  const absent = new Set(payload.attendance.filter(a => a.date === payload.selection.date && a.status === "absent").map(a => a.student_id));
  return payload.students.filter(s => !absent.has(s.id)).sort((a,b) => a.id.localeCompare(b.id));
}
// Use the lower of teacher competency and latest assessment when both exist.
export function conceptEvidence(payload:PlanningPayload, studentId:string, conceptId:string):number | null {
  const rows=payload.assessments.filter(a=>a.student_id===studentId&&a.concept_id===conceptId);
  return rows.length?computeMasteryEstimate(rows).mastery_estimate:payload.competencies.find(c=>c.student_id===studentId&&c.concept_id===conceptId)?.mastery??null;
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
  const maxLessons = Math.max(1, Math.min(4, Math.floor((payload.selection.availableMinutes - 5) / 12)));
  let candidateConcepts = concepts;
  if (candidateConcepts.length > maxLessons) {
    const scored = candidateConcepts.map(c => {
      const weak = students.filter(s => { const v = conceptEvidence(payload, s.id, c.id); return v !== null && v < 0.6; }).length;
      const unknown = students.filter(s => conceptEvidence(payload, s.id, c.id) === null).length;
      return { concept: c, score: weak * 2 + unknown };
    });
    const selectedIds = new Set<string>();
    const sorted = [...scored].sort((a, b) => b.score - a.score || a.concept.id.localeCompare(b.concept.id));
    for (const item of sorted) {
      if (selectedIds.size >= maxLessons) break;
      let curr: string | null = item.concept.id;
      const chain: string[] = [];
      while (curr) {
        chain.unshift(curr);
        const parent = candidateConcepts.find(c => c.id === curr)?.prerequisite_id ?? null;
        curr = parent && candidateConcepts.some(c => c.id === parent) ? parent : null;
      }
      for (const id of chain) {
        if (selectedIds.size < maxLessons || selectedIds.has(id)) {
          selectedIds.add(id);
        }
      }
    }
    candidateConcepts = candidateConcepts.filter(c => selectedIds.has(c.id));
    if (!candidateConcepts.length && concepts.length) {
      candidateConcepts = concepts.slice(0, maxLessons);
    }
  }
  const lessons:Lesson[] = [];
  for (const concept of candidateConcepts) {
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

function conceptActivity(conceptId: string): string {
  const activities: Record<string, string> = {
    M101: "Count a set of counters, then match the count to a written numeral.",
    M102: "Read number name cards and match them to digit cards 1–20.",
    M103: "Arrange number cards in order; point to one more and one less.",
    M104: "Combine two groups of counters and explain addition on a number line.",
    M105: "Take away counters from a group; record the subtraction sentence.",
    M106: "Show an empty set; explain why zero means none.",
    M107: "Use a strip of paper to compare two classroom objects by length.",
    M108: "Balance two objects on a pan balance; record heavier and lighter.",
    M109: "Sort shape cut-outs into circles, triangles, squares and rectangles.",
    M110: "Sort objects by colour, shape or size into labelled groups.",
    M201: "Read and write numbers up to 100 using a hundred chart.",
    M202: "Bundle sticks into tens and ones; read and build two-digit numbers.",
    M203: "Add two two-digit numbers using place-value blocks without regrouping.",
    M204: "Regroup ten ones into a ten using blocks before adding.",
    M205: "Subtract two-digit numbers using place-value blocks without borrowing.",
    M206: "Use tens-and-ones bundles to demonstrate exchanging a ten before subtraction.",
    M207: "Count in 2s, 5s and 10s using a number line or hundred chart.",
    M208: "Measure a classroom object with hand-spans or pencils; compare two objects.",
    M209: "Trace 2D shapes and count their sides and corners.",
    M210: "Read a pictograph and answer questions about the most and least.",
    M301: "Read and write numbers up to 1000 using expanded form.",
    M302: "Use hundreds-tens-ones blocks to build a three-digit number.",
    M303: "Add two three-digit numbers column by column without carrying.",
    M304: "Add three-digit numbers with carrying; check by estimation.",
    M305: "Subtract three-digit numbers without borrowing using columns.",
    M306: "Subtract with borrowing; exchange a hundred into tens.",
    M307: "Arrange counters in equal rows; write the repeated addition sentence.",
    M308: "Chant and write the multiplication table for a given number; check a peer.",
    M309: "Name common shapes in the classroom; trace and label them.",
    M310: "Count the sides and corners of cut-out shapes; record in a table.",
    M311: "Measure a book's length using hand-spans, then pencil lengths.",
    M312: "Measure classroom objects with a ruler in centimetres and metres.",
    M313: "Compare two classroom objects using a pan balance; record which is heavier.",
    M314: "Set a clock model to the given hour; draw the hands.",
    M315: "Set a clock model to the given minutes; read the time aloud.",
    M316: "Fold a shape along its line of symmetry; verify both halves match.",
    M317: "Identify the rule in a number pattern; continue it by three more terms.",
    M318: "Fill containers with water; compare capacity using the same cup.",
    M319: "Read a pictograph and a bar chart; answer two data questions each.",
    M320: "Share counters equally into groups; check the result with a multiplication fact.",
    M401: "Read and write numbers up to 10 000 using place-value charts.",
    M402: "Multiply a two-digit number by a one-digit number using the standard algorithm.",
    M403: "Divide objects equally; write the division sentence and check with multiplication.",
    M404: "Divide and find the remainder; verify with multiplication and addition.",
    M405: "List all factors of a number; find common multiples of two numbers.",
    M406: "Fold and shade equal parts of paper strips; name the fraction.",
    M407: "Label the numerator and denominator of a shaded fraction diagram.",
    M408: "Fold equal-sized paper strips into halves and quarters; compare equivalent parts.",
    M409: "Compare two fractions using paper strips; circle the larger fraction.",
    M410: "Draw a line segment of a given length with a ruler; label its endpoints.",
    M411: "Sort angle cut-outs into acute, right and obtuse groups.",
    M412: "Measure a classroom object and add side lengths to find its perimeter.",
    M413: "Count unit squares inside a shape drawn on squared paper.",
    M414: "Read a calendar and calculate the number of days between two dates.",
    M415: "Write five-digit numbers in words and expanded form.",
    M416: "Add and subtract large numbers in columns; estimate first.",
    M417: "Convert between kilograms and grams; read a kitchen scale.",
    M418: "Pour water from a litre bottle; measure capacity in millilitres.",
    M420: "Identify lines of symmetry in shapes by folding or using a mirror.",
    M421: "Read a bar graph and answer three data questions; draw a simple bar graph.",
    M425: "Draw a shape on squared paper; count full and half squares to find area.",
    count: "Count a set of counters, then match the count to a written numeral.",
    add: "Combine two groups of counters and explain addition on a number line.",
    place: "Bundle sticks into tens and ones; read and build two-digit numbers.",
    subtract: "Use tens-and-ones bundles to demonstrate exchanging a ten before subtraction.",
    multiply: "Arrange counters in equal rows; connect repeated addition to multiplication facts.",
    divide: "Share counters equally into groups; check the result with a multiplication fact.",
    fractions: "Fold equal-sized paper strips into halves and quarters; compare equivalent parts.",
    measure: "Measure a classroom object and add side lengths to find its perimeter.",
  };
  return activities[conceptId] ?? "Model one example with counters, drawings or a number line.";

}

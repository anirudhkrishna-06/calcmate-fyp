import { withTransaction, today } from "./database";

export const demoScope = { workspaceId: "demo-workspace-v1", teacherId: "demo-teacher-v1" };

export const canonicalConceptSeed = [
  // Grade 1 — 10 concepts
  ["M101", "Counting objects up to 20", 1, null],
  ["M102", "Number names up to 20", 1, "M101"],
  ["M103", "Number sequence and order", 1, "M101"],
  ["M104", "Addition within 20", 1, "M101"],
  ["M105", "Subtraction within 20", 1, "M101"],
  ["M106", "Introduction to zero", 1, null],
  ["M107", "Comparison of lengths", 1, null],
  ["M108", "Comparison of weight", 1, null],
  ["M109", "Basic 2D shapes", 1, null],
  ["M110", "Sorting and grouping", 1, "M101"],
  // Grade 2 — 10 concepts
  ["M201", "Numbers up to 100", 2, "M103"],
  ["M202", "Place value – tens and ones", 2, "M201"],
  ["M203", "Addition of two-digit numbers without regrouping", 2, "M202"],
  ["M204", "Addition of two-digit numbers with regrouping", 2, "M104"],
  ["M205", "Subtraction of two-digit numbers without borrowing", 2, "M105"],
  ["M206", "Subtraction of two-digit numbers with borrowing", 2, "M205"],
  ["M207", "Skip counting (2, 5, 10)", 2, "M201"],
  ["M208", "Non-standard measurement of length", 2, "M107"],
  ["M209", "2D shapes and their properties", 2, "M109"],
  ["M210", "Simple pictographs", 2, null],
  // Grade 3 — 20 concepts
  ["M301", "Number recognition up to 1000", 3, "M201"],
  ["M302", "Place value (ones/tens/hundreds)", 3, "M202"],
  ["M303", "Addition without carrying", 3, "M203"],
  ["M304", "Addition with carrying", 3, "M204"],
  ["M305", "Subtraction without borrowing", 3, "M205"],
  ["M306", "Subtraction with borrowing", 3, "M206"],
  ["M307", "Multiplication as repeated addition", 3, "M104"],
  ["M308", "Multiplication tables 2–10", 3, "M307"],
  ["M309", "Basic shapes recognition", 3, "M209"],
  ["M310", "Sides and corners", 3, "M309"],
  ["M311", "Length using non-standard units", 3, "M208"],
  ["M312", "Length using standard units (cm/m)", 3, "M311"],
  ["M313", "Weight basics", 3, "M108"],
  ["M314", "Time – reading a clock (hour)", 3, null],
  ["M315", "Time – reading a clock (minutes)", 3, "M314"],
  ["M316", "Symmetry and patterns", 3, "M309"],
  ["M317", "Number patterns and sequences", 3, "M207"],
  ["M318", "Capacity and volume basics", 3, null],
  ["M319", "Pictographs and simple charts", 3, "M210"],
  ["M320", "Division as equal sharing (basic)", 3, "M308"],
  // Grade 4 — 21 concepts
  ["M401", "Numbers up to 10000", 4, "M301"],
  ["M402", "Multiplication of 2-digit numbers", 4, "M308"],
  ["M403", "Division as equal sharing", 4, "M320"],
  ["M404", "Division with remainder", 4, "M403"],
  ["M405", "Factors and multiples", 4, "M402"],
  ["M406", "Equal parts of a whole", 4, "M403"],
  ["M407", "Fraction representation (numerator/denominator)", 4, "M406"],
  ["M408", "Equivalent fractions", 4, "M407"],
  ["M409", "Comparing fractions", 4, "M407"],
  ["M410", "Lines and line segments", 4, "M309"],
  ["M411", "Angles – basic types", 4, "M410"],
  ["M412", "Perimeter of simple shapes", 4, "M312"],
  ["M413", "Area – counting unit squares", 4, "M412"],
  ["M414", "Time – duration and calendar", 4, "M315"],
  ["M415", "Large numbers – reading and writing", 4, "M401"],
  ["M416", "Addition and subtraction of large numbers", 4, "M304"],
  ["M417", "Weight – kg and g", 4, "M313"],
  ["M418", "Capacity – litres and millilitres", 4, "M318"],
  ["M420", "Symmetry in shapes", 4, "M316"],
  ["M421", "Bar graphs and pictographs", 4, "M319"],
  ["M425", "Area using a grid", 4, "M413"],
] as const;

export const conceptSeed = canonicalConceptSeed;

// Canonical directed edges for the grades currently supported by the mobile
// application. Tuple order is dependent, prerequisite.
export const canonicalPrerequisiteSeed = [
  ["M102", "M101"], ["M103", "M101"], ["M104", "M101"], ["M105", "M101"],
  ["M204", "M104"], ["M205", "M105"], ["M201", "M103"], ["M202", "M201"],
  ["M203", "M202"], ["M204", "M203"], ["M205", "M202"], ["M206", "M205"],
  ["M207", "M201"], ["M302", "M301"], ["M303", "M302"], ["M304", "M303"],
  ["M305", "M302"], ["M306", "M305"], ["M307", "M304"], ["M308", "M307"],
  ["M310", "M309"], ["M312", "M311"], ["M315", "M314"], ["M316", "M309"],
  ["M317", "M301"], ["M320", "M308"], ["M401", "M302"], ["M402", "M308"],
  ["M403", "M308"], ["M404", "M403"], ["M405", "M308"], ["M407", "M406"],
  ["M408", "M407"], ["M409", "M407"], ["M410", "M310"], ["M411", "M410"],
  ["M412", "M312"], ["M413", "M412"], ["M425", "M413"], ["M414", "M315"],
  ["M415", "M401"], ["M416", "M401"], ["M417", "M313"], ["M418", "M318"],
  ["M420", "M316"], ["M421", "M319"]
] as const;



export const indianStudentNames = [
  "Aarav Sharma", "Diya Patel", "Vihaan Rao", "Ananya Singh", "Arjun Nair", "Ishita Das", "Kabir Khan", "Meera Iyer",
  "Reyansh Verma", "Aditi Joshi", "Rohan Ali", "Saanvi Reddy", "Dev Shah", "Tara Menon", "Yash Gupta", "Naina Bose",
  "Aditya Kulkarni", "Kavya Thomas", "Krish Mehta", "Siya Sinha", "Neel Kapoor", "Avni Jain", "Ibrahim Ansari", "Riya Sen",
  "Dhruv Malhotra", "Pihu Bhat", "Atharv Kumar", "Sara Fernandes", "Pranav Mishra", "Zoya Ahmed", "Harsh Yadav", "Lakshmi Pillai"
];
let seeding: Promise<void> | undefined;
export function seedDemo() {
  seeding ??= seed().catch(error => { seeding = undefined; throw error; });
  return seeding;
}
async function seed() {
  await withTransaction(async tx => {
    const existing = await tx.getFirstAsync<{ seeded_at: string | null }>("SELECT seeded_at FROM workspaces WHERE id=?", demoScope.workspaceId);
    if (existing?.seeded_at) {
      await repairCanonicalPrerequisites(tx, demoScope.workspaceId);
      return;
    }
    const w = demoScope.workspaceId;
    const now = new Date().toISOString();
    await tx.runAsync("INSERT OR IGNORE INTO workspaces(id,teacher_id,mode,created_at) VALUES(?,?,?,?)", w, demoScope.teacherId, "demo", now);
    const profile = { id: demoScope.teacherId, name: "Ananya Rao", schoolName: "Vidya Primary School", experience: 6, grades: [1,2,3,4], preferredSubject: "Math" };
    await tx.runAsync("INSERT INTO profiles VALUES(?,?,?,?,?)", profile.id, w, JSON.stringify(profile), now, now);
    for (const [id,title,grade,prerequisite] of conceptSeed) {
      await tx.runAsync(
        "INSERT INTO concepts(id,workspace_id,title,grade,prerequisite_id,created_at,updated_at,learning_objective,coverage_status,is_active,subject_area) VALUES(?,?,?,?,?,?,?,NULL,'verified',1,'Math')",
        id, w, title, grade, prerequisite, now, now);
    }
    await repairCanonicalPrerequisites(tx, w);
    for (let i = 0; i < indianStudentNames.length; i++) {
      const grade = Math.floor(i / 8) + 1;
      const id = `demo-student-${i + 1}`;
      await tx.runAsync("INSERT INTO students VALUES(?,?,?,?,?,?,?)", id, w, indianStudentNames[i], grade, String(i % 8 + 1).padStart(2,"0"), now, now);
      const relevant = conceptSeed.filter(c => c[2] === grade);
      for (const [concept] of relevant) {
        const mastery = [0.35,0.55,0.78,0.9,0.48,0.82,0.62,0.95][i % 8];
        await tx.runAsync("INSERT INTO competencies VALUES(?,?,?,?,?,?,?)", `${id}-${concept}`, w, id, concept, mastery, now, now);
        for (let j = 0; j < 2; j++) {
          const date = new Date(); date.setDate(date.getDate() - (j === 0 ? 14 : 3));
          const score = Math.max(1, Math.round(mastery * 10) - (j === 0 ? 1 : 0));
          await tx.runAsync("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)", `${id}-${concept}-${j}`, w, id, concept, date.toISOString().slice(0,10), score, 10, now, now);
        }
        const stateStatus = mastery >= 0.70 ? "likely_ready" : mastery >= 0.60 ? "insufficient" : "needs_support";
        await tx.runAsync(
          `INSERT OR IGNORE INTO learner_concept_states(id,workspace_id,student_id,concept_id,mastery_estimate,evidence_count,last_evidence_at,estimator_name,estimator_version,state_status,evidence_sufficiency,updated_at,created_at)
           VALUES(?,?,?,?,?,?,?,'score-ratio-v1','1',?,'moderate',?,?)`,
          `lcs-${id}-${concept}`, w, id, concept, mastery, 2, now.slice(0, 10), stateStatus, now, now
        );
      }

      for (let day = 0; day < 5; day++) {
        const date = new Date(); date.setDate(date.getDate() - day);
        const dateString = day === 0 ? today() : `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
        await tx.runAsync("INSERT INTO attendance VALUES(?,?,?,?,?,?,?)", `${id}-${dateString}`, w, id, dateString, (i + day) % 9 === 0 ? "absent" : "present", now, now);
      }
      await tx.runAsync("INSERT INTO observations VALUES(?,?,?,?,?,?)", `${id}-observation`, w, id,
        i % 8 < 2 ? "Needs concrete objects and a prerequisite recap before independent practice." : "Participates in pair work; explain reasoning before recording answers.", now, now);
    }
    await tx.runAsync("UPDATE workspaces SET seeded_at=? WHERE id=?", now, w);
  });
}

export async function repairCanonicalPrerequisites(tx: any, workspaceId: string) {
  const ids = canonicalConceptSeed.map(([id]) => id);
  const placeholders = ids.map(() => "?").join(",");
  await tx.runAsync(
    `DELETE FROM concept_prerequisites WHERE workspace_id=? AND concept_id IN (${placeholders}) AND prerequisite_id IN (${placeholders})`,
    workspaceId, ...ids, ...ids
  );
  for (const [conceptId, prerequisiteId] of canonicalPrerequisiteSeed) {
    await tx.runAsync(
      "INSERT OR IGNORE INTO concept_prerequisites(workspace_id,concept_id,prerequisite_id,relationship_type,confidence) VALUES(?,?,?,?,?)",
      workspaceId, conceptId, prerequisiteId, "PREREQUISITE_OF", "verified"
    );
  }
}

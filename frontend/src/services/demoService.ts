import { withTransaction, today } from "./database";

export const demoScope = { workspaceId: "demo-workspace-v1", teacherId: "demo-teacher-v1" };
export const conceptSeed = [
  ["count", "Counting to 20", 1, null], ["add", "Addition within 20", 1, "count"],
  ["place", "Place value", 2, "count"], ["subtract", "Subtraction with regrouping", 2, "place"],
  ["multiply", "Multiplication facts", 3, "add"], ["divide", "Division as equal sharing", 3, "multiply"],
  ["fractions", "Equivalent fractions", 4, "divide"], ["measure", "Perimeter and measurement", 4, "add"]
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
    if (existing?.seeded_at) return;
    const w = demoScope.workspaceId;
    const now = new Date().toISOString();
    await tx.runAsync("INSERT OR IGNORE INTO workspaces(id,teacher_id,mode,created_at) VALUES(?,?,?,?)", w, demoScope.teacherId, "demo", now);
    const profile = { id: demoScope.teacherId, name: "Ananya Rao", schoolName: "Vidya Primary School", experience: 6, grades: [1,2,3,4], preferredSubject: "Math" };
    await tx.runAsync("INSERT INTO profiles VALUES(?,?,?,?,?)", profile.id, w, JSON.stringify(profile), now, now);
    for (const [id,title,grade,prerequisite] of conceptSeed) {
      await tx.runAsync("INSERT INTO concepts VALUES(?,?,?,?,?,?,?)", id, w, title, grade, prerequisite, now, now);
    }
    for (let i = 0; i < indianStudentNames.length; i++) {
      const grade = Math.floor(i / 8) + 1;
      const id = `demo-student-${i + 1}`;
      await tx.runAsync("INSERT INTO students VALUES(?,?,?,?,?,?,?)", id, w, indianStudentNames[i], grade, String(i % 8 + 1).padStart(2,"0"), now, now);
      const relevant = conceptSeed.filter(c => c[2] === grade || c[0] === conceptSeed.find(c => c[2] === grade)?.[3]);
      for (const [concept] of relevant) {
        const mastery = [0.35,0.55,0.78,0.9,0.48,0.82,0.62,0.95][i % 8];
        await tx.runAsync("INSERT INTO competencies VALUES(?,?,?,?,?,?,?)", `${id}-${concept}`, w, id, concept, mastery, now, now);
        for (let j = 0; j < 2; j++) {
          const date = new Date(); date.setDate(date.getDate() - (j === 0 ? 14 : 3));
          const score = Math.max(1, Math.round(mastery * 10) - (j === 0 ? 1 : 0));
          await tx.runAsync("INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?)", `${id}-${concept}-${j}`, w, id, concept, date.toISOString().slice(0,10), score, 10, now, now);
        }
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

import { ScheduleItem, Student, Teacher } from "@/types/domain";

export const teacher: Teacher = {
  id: "teacher-local",
  name: "Ananya Rao",
  schoolName: "Green Valley Primary",
  grades: [1, 2, 3, 4, 5],
  preferredSubject: "Math"
};

export const students: Student[] = [
  {
    id: "st-001",
    name: "Mira Sen",
    grade: 4,
    rollNumber: "04",
    currentUnit: "Equivalent fractions",
    mastery: 0.72,
    lastSeenLabel: "Today"
  },
  {
    id: "st-002",
    name: "Kabir Ali",
    grade: 4,
    rollNumber: "08",
    currentUnit: "Perimeter",
    mastery: 0.54,
    lastSeenLabel: "Yesterday"
  },
  {
    id: "st-003",
    name: "Nila Thomas",
    grade: 3,
    rollNumber: "13",
    currentUnit: "Reading clocks",
    mastery: 0.81,
    lastSeenLabel: "2 days ago"
  }
];

export const scheduleItems: ScheduleItem[] = [
  {
    id: "sch-001",
    title: "Fraction warm-up circle",
    grade: 4,
    durationMinutes: 20,
    focus: "Compare equal parts before naming equivalent fractions.",
    studentIds: ["st-001", "st-002"]
  },
  {
    id: "sch-002",
    title: "Clock reading pair practice",
    grade: 3,
    durationMinutes: 15,
    focus: "Use minute marks with classroom clock cards.",
    studentIds: ["st-003"]
  }
];

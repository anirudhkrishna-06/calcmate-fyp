export type Grade = 1 | 2 | 3 | 4 | 5;

export type Teacher = {
  id: string;
  name: string;
  schoolName: string;
  grades: Grade[];
  preferredSubject: "Math";
  experience?: number;
};

export type Student = {
  id: string;
  name: string;
  grade: Grade;
  rollNumber: string;
  currentUnit: string;
  mastery: number;
  lastSeenLabel: string;
  hasEvidence?: boolean;
  needsRevision?: boolean;
};

export type ScheduleItem = {
  id: string;
  title: string;
  grade: Grade;
  durationMinutes: number;
  focus: string;
  studentIds: string[];
};

export type RetrievedChunkSummary = {
  chunkId: number;
  sourcePdf: string;
  score: number;
  conceptIds: string[];
};

export type ChatResponse = {
  answer: string;
  sources: RetrievedChunkSummary[];
  refused: boolean;
};

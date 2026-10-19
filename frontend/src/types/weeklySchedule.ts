/**
 * Weekly Schedule Types
 *
 * A weekly schedule covers Mon-Fri for a given ISO week.
 * Each day is broken into named time slots:
 *   09:00-09:40  Period 1  (40 min teaching)
 *   09:40-09:45  Changeover (5 min)
 *   09:45-10:25  Period 2  (40 min teaching)
 *   10:25-10:30  Changeover
 *   10:30-10:50  Snack Break (20 min)
 *   10:50-11:30  Period 3  (40 min teaching)
 *   11:30-11:35  Changeover
 *   11:35-12:15  Period 4  (40 min teaching)
 *   12:15-13:00  Lunch Break (45 min)
 *   13:00-13:40  Period 5  (40 min teaching)
 *   13:40-13:45  Changeover
 *   13:45-14:00  Wrap-up / Exit (15 min)
 *
 * Total teaching: 5 × 40 = 200 min
 * Total day: 09:00-14:00 = 300 min
 */

import type { GeneralSchedule } from './generalSchedule';

export type SlotKind = 'period' | 'changeover' | 'snack' | 'lunch' | 'wraup';

export interface TimeSlot {
  /** HH:MM 24-hour start */
  startTime: string;
  /** HH:MM 24-hour end */
  endTime: string;
  /** Duration in minutes */
  durationMinutes: number;
  kind: SlotKind;
  /** e.g. "Period 1", "Snack Break", "Lunch" */
  label: string;
  /** Only set for 'period' slots – index 0-4 */
  periodIndex?: number;
}

export interface DaySchedule {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** 1=Mon … 5=Fri */
  dayOfWeek: 1 | 2 | 3 | 4 | 5;
  dayLabel: string;
  slots: TimeSlot[];
  /** The generated rotation schedule for each teaching period, keyed by periodIndex */
  periodSchedules: Record<number, GeneralSchedule>;
  /** true if the teacher has re-generated the schedule after new attendance/assessment data */
  isOutdated: boolean;
}

export interface WeeklySchedule {
  id: string;
  workspaceId: string;
  teacherId: string;
  /** ISO date of Monday for this week */
  weekStartDate: string;
  /** Grades included every day */
  grades: number[];
  days: DaySchedule[];
  createdAt: string;
  updatedAt: string;
}

/** Compact summary for the schedule list */
export interface WeeklyScheduleSummary {
  id: string;
  weekStartDate: string;
  grades: number[];
  createdAt: string;
  daysWithSchedule: number;
  totalPeriods: number;
}

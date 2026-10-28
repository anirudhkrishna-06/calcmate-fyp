/**
 * Pre-Class Briefing — redesigned for Review 3.
 *
 * Shows a knowledge snapshot (weak counts per grade, prerequisite gaps)
 * before generating the schedule, giving the teacher situational awareness
 * before they walk into the classroom.
 */
import { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ClassFlow, DetailPanel } from '@/components/ClassFlow';
import { DateField } from '@/components/DateField';
import { Choices } from '@/components/Choices';
import { FormStatus } from '@/components/FormStatus';
import { Section } from '@/components/Workspace';
import { useLocalData } from '@/hooks/useLocalData';
import { loadTeacher } from '@/services/storageService';
import { today, withTransaction, assertScope } from '@/services/database';
import { requireSession } from '@/services/authService';
import { createGeneralSchedule } from '@/services/generalScheduleService';
import { colors } from '@/theme';
import type { Grade } from '@/types/domain';
import type { GeneralSelection } from '@/types/generalSchedule';

// ─── Snapshot Loader ──────────────────────────────────────────────────────────
interface GradeSnapshot {
  grade: number;
  total: number;
  presentToday: number;
  weak: number;           // mastery < 0.6
  prerequisiteGaps: number;
  focusConcept: string;
}

async function loadClassroomSnapshot(grades: number[], forDate: string): Promise<GradeSnapshot[]> {
  const session = await requireSession();
  return withTransaction(async tx => {
    await assertScope(tx, session);
    const w = session.workspaceId;
    const results: GradeSnapshot[] = [];
    for (const grade of grades) {
      const totalRow = await tx.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) n FROM students WHERE workspace_id=? AND grade=?', w, grade
      );
      const presentRow = await tx.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) n FROM attendance WHERE workspace_id=? AND date=? AND status IN ('present','late')
         AND student_id IN (SELECT id FROM students WHERE workspace_id=? AND grade=?)`,
        w, forDate, w, grade
      );
      const weakRow = await tx.getFirstAsync<{ n: number }>(
        `SELECT COUNT(DISTINCT student_id) n FROM learner_concept_states
         WHERE workspace_id=? AND state_status='needs_support'
         AND student_id IN (SELECT id FROM students WHERE workspace_id=? AND grade=?)`,
        w, w, grade
      );
      const gapRow = await tx.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) n FROM learner_concept_states lcs
         WHERE lcs.workspace_id=? AND lcs.state_status IN ('needs_support','unknown')
         AND EXISTS (
           SELECT 1 FROM concept_prerequisites cp
           JOIN learner_concept_states lcs2
             ON lcs2.workspace_id=lcs.workspace_id
            AND lcs2.student_id=lcs.student_id
            AND lcs2.concept_id=cp.concept_id
           WHERE cp.workspace_id=lcs.workspace_id
             AND cp.prerequisite_id=lcs.concept_id
             AND lcs2.state_status='needs_support'
         )
         AND lcs.student_id IN (SELECT id FROM students WHERE workspace_id=? AND grade=?)`,
        w, w, grade
      );
      const focusRow = await tx.getFirstAsync<{ title: string }>(
        `SELECT c.title FROM learner_concept_states lcs
         JOIN concepts c ON c.workspace_id=lcs.workspace_id AND c.id=lcs.concept_id
         WHERE lcs.workspace_id=? AND lcs.state_status='needs_support'
           AND lcs.student_id IN (SELECT id FROM students WHERE workspace_id=? AND grade=?)
         GROUP BY lcs.concept_id ORDER BY COUNT(*) DESC LIMIT 1`,
        w, w, grade
      );
      results.push({
        grade,
        total: totalRow?.n ?? 0,
        presentToday: presentRow?.n ?? 0,
        weak: weakRow?.n ?? 0,
        prerequisiteGaps: gapRow?.n ?? 0,
        focusConcept: focusRow?.title ?? 'No data yet',
      });
    }
    return results;
  });
}

// ─── Grade Snapshot Card ───────────────────────────────────────────────────────
function GradeCard({ snap }: { snap: GradeSnapshot }) {
  const weakPct = snap.total > 0 ? Math.round((snap.weak / snap.total) * 100) : 0;
  const urgency = weakPct > 50 ? 'high' : weakPct > 25 ? 'medium' : 'low';
  const urgencyColor = urgency === 'high' ? colors.danger : urgency === 'medium' ? colors.attention : colors.forest;
  const urgencyBg = urgency === 'high' ? '#FDE8E8' : urgency === 'medium' ? '#FFF3CD' : colors.sageLight;

  return (
    <View style={[styles.gradeCard, { borderLeftColor: urgencyColor }]}>
      {/* Grade badge */}
      <View style={[styles.gradeBadge, { backgroundColor: urgencyBg }]}>
        <AppText style={{ fontWeight: '900', fontSize: 18, color: urgencyColor }}>G{snap.grade}</AppText>
      </View>

      <View style={{ flex: 1, gap: 6 }}>
        {/* Focus concept */}
        <AppText style={{ fontWeight: '700', fontSize: 14, color: colors.text }}>
          {snap.focusConcept}
        </AppText>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatChip icon="" value={`${snap.presentToday}/${snap.total}`} label="Present" color={colors.forest} />
          <StatChip icon="⚠️" value={`${snap.weak}`} label="support" color={urgencyColor} />
          {snap.prerequisiteGaps > 0 && (
            <StatChip icon="" value={`${snap.prerequisiteGaps}`} label="gaps" color={colors.attention} />
          )}
        </View>

        <DetailPanel title="Learning details">
          <AppText variant="small" muted>{snap.weak} of {snap.total} learners need support. {snap.prerequisiteGaps} prerequisite gaps.</AppText>
        </DetailPanel>
      </View>
    </View>
  );
}

function StatChip({ icon, value, label, color }: { icon: string; value: string; label: string; color: string }) {
  return (
    <View style={styles.statChip}>
      <AppText style={{ fontSize: 12 }}>{icon}</AppText>
      <AppText style={{ fontWeight: '700', fontSize: 13, color }}>{value}</AppText>
      <AppText variant="small" style={{ color: colors.charcoalMuted, fontSize: 11 }}>{label}</AppText>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function NewGeneralSchedule() {
  const { data: teacher, error: profileError, loading: profileLoading, reload: reloadProfile } = useLocalData(loadTeacher);
  const [selected, setSelected] = useState<Grade[] | null>(null);
  const grades = selected ?? teacher?.grades ?? [];
  const [date, setDate] = useState(today());
  const [priority, setPriority] = useState<GeneralSelection['priority']>('learning-needs');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Classroom snapshot — reloads whenever grades or date changes
  const gradeKey = grades.join(',');
  const snapshotLoader = useCallback(async () => {
    if (!gradeKey) return [];
    return loadClassroomSnapshot(gradeKey.split(',').map(Number), date);
  }, [gradeKey, date]);

  const { data: snapshot, loading: snapshotLoading } = useLocalData(snapshotLoader);

  async function generate() {
    setBusy(true); setError('');
    try {
      const saved = await createGeneralSchedule({ date, grades, priority, availableMinutes: 40 });
      router.replace(`/general-schedule/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create schedule.');
    } finally {
      setBusy(false);
    }
  }

  // Summary stats across all grades
  const totalStudents = snapshot?.reduce((s, g) => s + g.total, 0) ?? 0;
  const totalPresent  = snapshot?.reduce((s, g) => s + g.presentToday, 0) ?? 0;
  const totalWeak     = snapshot?.reduce((s, g) => s + g.weak, 0) ?? 0;
  const hasGaps       = snapshot?.some(g => g.prerequisiteGaps > 0) ?? false;

  return (
    <Screen
      topInset={false}
      footer={
        <Button
          label={busy ? 'Creating schedule…' : 'Generate schedule'}
          icon="play-circle-outline"
          disabled={busy || profileLoading || !!profileError || !grades.length}
          onPress={() => void generate()}
        />
      }
    >
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        <View style={styles.heroTextBlock}>
          <ClassFlow step={0} />
          <AppText variant="title">Ready for class?</AppText>
          <AppText muted>
            Choose your grades. Plan the next 40 minutes.
          </AppText>
        </View>
        {teacher && <AppText variant="small" muted>{teacher.name} · {teacher.schoolName}</AppText>}
      </View>

      <FormStatus message={error || profileError} error />
      {profileError ? <Button label="Retry" variant="quiet" onPress={() => void reloadProfile()} /> : null}

      {/* ── Date + Grades ─────────────────────────────────────────── */}
      <Section title="Your class">
        <DateField label="Date" value={date} onChange={setDate} disabled={busy} />
        <Choices
          multiple
          values={[1, 2, 3, 4, 5].map(g => ({
            value: String(g),
            label: `G${g}`,
            disabled: busy || profileLoading,
          }))}
          selected={grades.map(String)}
          onSelect={value => {
            const g = Number(value) as Grade;
            setSelected(grades.includes(g) ? grades.filter(v => v !== g) : [...grades, g]);
          }}
        />
      </Section>

      {/* ── Classroom Snapshot ────────────────────────────────────── */}
      {snapshot && snapshot.length > 0 && (
        <Section
          title="At a glance"
          detail={snapshotLoading ? 'Updating…' : `${totalPresent}/${totalStudents} marked present`}
        >
          {/* Summary banner */}
          {totalWeak > 0 && (
            <View style={[styles.alertBanner, { borderColor: totalWeak > totalStudents / 2 ? colors.danger : colors.attention }]}>
              <AppText style={{ fontWeight: '700', color: colors.danger }}>
                {totalWeak} learners need support
              </AppText>
              {hasGaps && <AppText variant="small" muted>Foundations first: prerequisite gaps found.</AppText>}
            </View>
          )}

          {/* Per-grade cards */}
          {snapshot.map(snap => <GradeCard key={snap.grade} snap={snap} />)}
        </Section>
      )}

      {/* ── Priority ──────────────────────────────────────────────── */}
      <Section title="Time allocation">
        <Choices
          values={[
            { value: 'learning-needs', label: 'Learning Needs', disabled: busy },
            { value: 'balanced', label: 'Balanced', disabled: busy },
          ]}
          selected={[priority]}
          onSelect={v => setPriority(v as GeneralSelection['priority'])}
        />
        <AppText variant="small" muted>
          {priority === 'learning-needs'
            ? 'Extra time where support is needed.'
            : 'Equal time for each grade.'}
        </AppText>
      </Section>

      {/* ── Quick link to Weekly Plan ─────────────────────────────── */}
      <Section title="Planning ahead?">
        <Button
          label="Plan a week"
          icon="calendar-outline"
          variant="secondary"
          onPress={() => router.push('/weekly-schedule/new')}
        />
        <AppText variant="small" muted>
          Mon–Fri · 5 periods a day · Breaks included.
        </AppText>
      </Section>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  hero: {
    gap: 12,
  },
  heroTextBlock: {
    gap: 6,
  },
  teacherChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.sageLight,
    borderRadius: 12,
    padding: 12,
  },
  gradeCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 5,
    padding: 14,
    alignItems: 'flex-start',
  },
  gradeBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.line,
  },
  bar: {
    height: 6,
    backgroundColor: colors.line,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  alertBanner: {
    borderLeftWidth: 4,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 4,
    backgroundColor: colors.surface,
  },
});

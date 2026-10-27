/**
 * Weekly Schedule Creator — choose grades and anchor date, then generate
 * a full Mon-Fri schedule based on current student knowledge states.
 */
import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Choices } from '@/components/Choices';
import { DateField } from '@/components/DateField';
import { FormStatus } from '@/components/FormStatus';
import { Section } from '@/components/Workspace';
import { useLocalData } from '@/hooks/useLocalData';
import { loadTeacher } from '@/services/storageService';
import { today } from '@/services/database';
import { createWeeklySchedule } from '@/services/weeklyScheduleService';
import { mondayOf, weekDates } from '@/services/weeklyScheduleEngine';
import type { Grade } from '@/types/domain';
import { colors, spacing } from '@/theme';

const TIME_STRUCTURE = [
  { time: '09:00 – 09:40', label: 'Period 1', kind: 'period' },
  { time: '09:40 – 09:45', label: 'Changeover', kind: 'break' },
  { time: '09:45 – 10:25', label: 'Period 2', kind: 'period' },
  { time: '10:25 – 10:30', label: 'Changeover', kind: 'break' },
  { time: '10:30 – 10:50', label: 'Snack Break', kind: 'break' },
  { time: '10:50 – 11:30', label: 'Period 3', kind: 'period' },
  { time: '11:30 – 11:35', label: 'Changeover', kind: 'break' },
  { time: '11:35 – 12:15', label: 'Period 4', kind: 'period' },
  { time: '12:15 – 13:00', label: 'Lunch Break', kind: 'break' },
  { time: '13:00 – 13:40', label: 'Period 5', kind: 'period' },
  { time: '13:40 – 13:45', label: 'Changeover', kind: 'break' },
  { time: '13:45 – 14:00', label: 'Wrap-up & Exit', kind: 'break' },
];

export default function NewWeeklyScheduleScreen() {
  const { data: teacher, error: profileError, loading } = useLocalData(loadTeacher);
  const [selected, setSelected] = useState<Grade[] | null>(null);
  const grades = selected ?? (teacher?.grades ?? []);
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    if (!grades.length) { setError('Select at least one grade.'); return; }
    setBusy(true); setError('');
    try {
      const ws = await createWeeklySchedule(grades as Grade[], date);
      router.replace(`/weekly-schedule/${ws.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate weekly schedule.');
    } finally {
      setBusy(false);
    }
  }

  const weekMonday = mondayOf(date);
  const weekFriday = weekDates(date)[4].date;

  return (
    <Screen
      topInset={false}
      footer={
        <Button
          label={busy ? 'Generating and saving…' : 'Generate & Save Weekly Plan'}
          icon="calendar-outline"
          disabled={busy || loading || !!profileError}
          onPress={() => void handleGenerate()}
        />
      }
    >
      {/* Header */}
      <View style={styles.hero}>
        <AppText variant="title">Weekly Classroom Plan</AppText>
        <AppText muted>
          Generates a full Mon–Fri schedule based on current student knowledge states,
          attendance and prerequisite gaps — not from lesson 1.
        </AppText>
      </View>

      <FormStatus message={error || profileError} error />

      {/* Anchor Date */}
      <Section title="Week" detail="Pick any day — the schedule covers the full Monday to Friday">
        <DateField label="Any date in the target week" value={date} onChange={setDate} disabled={busy} />
        <View style={styles.weekBadge}>
          <AppText variant="small" style={{ color: colors.forest, fontWeight: '700' }}>
            {weekMonday} → {weekFriday}
          </AppText>
        </View>
      </Section>

      {/* Grade Selection */}
      <Section title="Grades" detail="The teacher focus moves according to learning need; other groups continue with guided independent work.">
        <Choices
          multiple
          values={[1, 2, 3, 4, 5].map(g => ({
            value: String(g),
            label: `Grade ${g}`,
            disabled: busy || loading,
          }))}
          selected={grades.map(String)}
          onSelect={value => {
            const g = Number(value) as Grade;
            setSelected(grades.includes(g) ? grades.filter(v => v !== g) : [...grades, g]);
          }}
        />
      </Section>

      {/* Day structure preview */}
      <Section title="Daily Structure" detail="Fixed for every school day — AI adapts who teaches what">
        <View style={styles.structureCard}>
          {TIME_STRUCTURE.map((row, i) => (
            <View key={i} style={[styles.structureRow, row.kind === 'break' && styles.structureBreak]}>
              <AppText
                variant="small"
                style={[styles.structureTime, { color: row.kind === 'period' ? colors.forest : colors.charcoalMuted }]}
              >
                {row.time}
              </AppText>
              <AppText
                variant="small"
                style={{ fontWeight: row.kind === 'period' ? '700' : '400', color: row.kind === 'period' ? colors.text : colors.charcoalMuted }}
              >
                {row.label}{row.kind === 'period' ? ' · 40 min' : ''}
              </AppText>
            </View>
          ))}
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: 8,
    paddingBottom: spacing.sm,
  },
  weekBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.sageLight,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 4,
  },
  structureCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  structureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  structureBreak: {
    backgroundColor: colors.background,
  },
  structureTime: {
    width: 130,
    fontVariant: ['tabular-nums'],
  },
});

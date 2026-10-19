/**
 * GeneralTimeline — Pre-Class detail view (refined for Review 3).
 *
 * Shows each rotation block as a rich card:
 *  • Colour-coded left border (forest = instruction, sage = opening/closing, line = transition)
 *  • Grade pills with mastery bars for each activity
 *  • Inline editable fields (teacher activity, duration, grade activity, objective)
 *  • Block status selector (planned / completed / postponed)
 *  • "Open concept graph" link per grade activity
 *  • Outdated / warnings banners
 *  • Footer: Start active class + Save
 */
import { useState, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppText } from './AppText';
import { Button } from './Button';
import { TextField } from './TextField';
import { Choices } from './Choices';
import { FormStatus } from './FormStatus';
import { Screen } from './Screen';
import { colors, spacing } from '@/theme';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useLocalData } from '@/hooks/useLocalData';
import { saveGeneralBlocks, isScheduleOutdated } from '@/services/generalScheduleService';
import { classLearningEvidence, attendanceRegister } from '@/services/classroomService';
import { today } from '@/services/database';
import type { GeneralSchedule, RotationBlock, GradeNeed, RotationActivity } from '@/types/generalSchedule';

// ─── Block kind config ────────────────────────────────────────────────────────
const KIND_COLOR: Record<RotationBlock['kind'], string> = {
  opening:     colors.sage,
  instruction: colors.forest,
  transition:  colors.line,
  closing:     colors.sage,
};
const KIND_LABEL: Record<RotationBlock['kind'], string> = {
  opening:     'Opening',
  instruction: 'Instruction',
  transition:  'Transition',
  closing:     'Closing',
};

// ─── Mastery bar ──────────────────────────────────────────────────────────────
function MasteryBar({ need }: { need?: GradeNeed }) {
  if (!need || need.attending === 0) return null;
  const onTrack = need.attending - need.weak;
  const pct = Math.round((onTrack / need.attending) * 100);
  const color = pct < 50 ? colors.danger : pct < 75 ? colors.attention : colors.forest;
  return (
    <View style={{ gap: 2, marginTop: 4 }}>
      <View style={barStyles.track}>
        <View style={[barStyles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <AppText variant="small" style={{ color: colors.charcoalMuted, fontSize: 11 }}>
        {onTrack}/{need.attending} on track{need.prerequisiteGap ? ' · Prereq gap' : ''}
      </AppText>
    </View>
  );
}

const barStyles = StyleSheet.create({
  track: { height: 5, backgroundColor: colors.line, borderRadius: 3, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 3 },
});

// ─── Single block card ────────────────────────────────────────────────────────
function BlockCard({
  block,
  index,
  needs,
  editing,
  busy,
  total,
  elapsed,
  onEdit,
  onUpdate,
  onActivityType,
  onStatusChange,
}: {
  block: RotationBlock;
  index: number;
  needs: GradeNeed[];
  editing: boolean;
  busy: boolean;
  total: number;
  elapsed: number;
  onEdit: () => void;
  onUpdate: (patch: Partial<RotationBlock>) => void;
  onActivityType: (grade: number, activityType: NonNullable<RotationActivity['activityType']>) => void;
  onStatusChange: (s: RotationBlock['status']) => void;
}) {
  const borderColor = KIND_COLOR[block.kind];
  const startMin = elapsed;
  const endMin   = elapsed + block.durationMinutes;

  return (
    <View
      style={[
        styles.blockCard,
        { borderLeftColor: borderColor, opacity: block.status === 'postponed' ? 0.65 : 1 },
      ]}
    >
      {/* ── Block header ── */}
      <View style={styles.blockHeader}>
        {/* Time badge */}
        <View style={styles.timeBadge}>
          <AppText style={{ fontWeight: '800', fontSize: 13, color: colors.forest, fontVariant: ['tabular-nums'] }}>
            {String(startMin).padStart(2, '0')}–{String(endMin).padStart(2, '0')}
          </AppText>
          <AppText variant="small" style={{ color: colors.charcoalMuted }}>{block.durationMinutes} min</AppText>
        </View>

        {/* Kind + teacher */}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.kindRow}>
            <View style={[styles.kindPill, { backgroundColor: borderColor === colors.line ? colors.background : colors.sageLight }]}>
              <AppText style={{ fontSize: 11, fontWeight: '700', color: borderColor === colors.line ? colors.charcoalMuted : colors.forest }}>
                {KIND_LABEL[block.kind]}
              </AppText>
            </View>
            {block.teacherGrade !== null && (
              <View style={styles.teacherPill}>
                <AppText style={{ fontSize: 11, fontWeight: '700', color: colors.white }}>
                  TEACHER → GR {block.teacherGrade}
                </AppText>
              </View>
            )}
          </View>

          {editing ? (
            <TextField
              label="Teacher activity"
              value={block.teacherActivity}
              multiline
              editable={!busy}
              onChangeText={v => onUpdate({ teacherActivity: v })}
            />
          ) : (
            <AppText style={{ fontSize: 14, color: colors.text, marginTop: 2 }}>{block.teacherActivity}</AppText>
          )}
          <AppText variant="small" muted style={{ marginTop: 1 }}>{block.reason}</AppText>
        </View>
      </View>

      {/* ── Grade activities ── */}
      <View style={styles.activitiesContainer}>
        {block.activities.map(a => {
          const need = needs.find(n => n.grade === a.grade);
          const isGuided = a.grade === block.teacherGrade;
          return (
            <View
              key={a.grade}
              style={[styles.activityRow, isGuided ? styles.activityGuided : styles.activityIndependent]}
            >
              {/* Grade label */}
              <View style={[styles.activityGradeBadge, { backgroundColor: isGuided ? colors.forest : colors.sageLight }]}>
                <AppText style={{ fontWeight: '900', fontSize: 12, color: isGuided ? colors.white : colors.forest }}>
                  G{a.grade}
                </AppText>
              </View>

              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.conceptRow}>
                  <AppText style={{ fontWeight: '700', fontSize: 13, color: isGuided ? colors.forest : colors.text }}>
                    {a.concept}
                  </AppText>
                  {isGuided && (
                    <View style={styles.guidedBadge}>
                      <AppText style={{ fontSize: 10, fontWeight: '700', color: colors.white }}>GUIDED</AppText>
                    </View>
                  )}
                </View>

                {editing ? (
                  <>
                    <TextField
                      label={`Grade ${a.grade} activity`}
                      value={a.activity}
                      multiline
                      editable={!busy}
                      onChangeText={value =>
                        onUpdate({ activities: block.activities.map(v => v.grade === a.grade ? { ...v, activity: value } : v) })
                      }
                    />
                    <TextField
                      label={`Grade ${a.grade} objective`}
                      value={a.objective}
                      multiline
                      editable={!busy}
                      onChangeText={value =>
                        onUpdate({ activities: block.activities.map(v => v.grade === a.grade ? { ...v, objective: value } : v) })
                      }
                    />
                  </>
                ) : (
                  <>
                    <AppText style={{ fontSize: 13, color: colors.charcoal }}>{a.activity}</AppText>
                    <AppText variant="small" muted>{a.objective}</AppText>
                  </>
                )}

                {!isGuided && <Choices
                  values={[
                    { value: 'independent', label: 'Independent', disabled: busy },
                    { value: 'pair', label: 'Pair', disabled: busy },
                    { value: 'group', label: 'Group', disabled: busy },
                    { value: 'worksheet', label: 'Worksheet', disabled: busy },
                    { value: 'assessment', label: 'Assessment', disabled: busy },
                  ]}
                  selected={[a.activityType ?? (a.activity.toLowerCase().includes('pair') ? 'pair' : a.activity.toLowerCase().includes('worksheet') ? 'worksheet' : a.activity.toLowerCase().includes('quiz') || a.activity.toLowerCase().includes('check') ? 'assessment' : 'independent')]}
                  onSelect={value => onActivityType(a.grade, value as NonNullable<RotationActivity['activityType']>)}
                />}

                {/* Mastery bar */}
                <MasteryBar need={need} />

                {/* Concept graph link */}
                {a.conceptId && (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/curriculum',
                        params: { grade: String(a.grade), conceptId: a.conceptId, origin: 'general-schedule' },
                      })
                    }
                    style={styles.graphLink}
                    accessibilityRole="button"
                  >
                    <AppText style={{ fontSize: 12, color: colors.forest, fontWeight: '600' }}>
                      Knowledge Graph
                    </AppText>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* ── Edit duration ── */}
      {editing && (
        <TextField
          label="Duration (minutes)"
          value={String(block.durationMinutes)}
          keyboardType="number-pad"
          editable={!busy}
          onChangeText={v => onUpdate({ durationMinutes: v.trim() ? Number(v) : 0 })}
        />
      )}

      {/* ── Status + edit toggle ── */}
      <View style={styles.blockFooter}>
        <Choices
          values={[
            { value: 'planned',   label: 'Planned',   disabled: busy },
            { value: 'completed', label: 'Delivered',  disabled: busy },
            { value: 'postponed', label: 'Postponed',  disabled: busy },
          ]}
          selected={[block.status]}
          onSelect={v => onStatusChange(v as RotationBlock['status'])}
        />
        <Button
          label={editing ? 'Done editing' : 'Edit'}
          variant="quiet"
          disabled={busy}
          accessibilityLabel={`${editing ? 'Done editing' : 'Edit'} block ${index + 1}`}
          onPress={onEdit}
          style={{ alignSelf: 'flex-start' }}
        />
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function GeneralTimeline({ schedule }: { schedule: GeneralSchedule }) {
  const [blocks, setBlocks]     = useState(schedule.blocks);
  const [baseline, setBaseline] = useState(JSON.stringify(schedule.blocks));
  const [outdated, setOutdated] = useState(false);
  const [editing, setEditing]   = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [message, setMessage]   = useState('');
  const [failed, setFailed]     = useState(false);
  const snapshotLoader = useCallback(async () => Promise.all(schedule.selection.grades.map(async grade => ({
    grade,
    evidence: await classLearningEvidence(grade),
    attendance: await attendanceRegister(grade, today()),
  }))), [schedule.selection.grades.join(',')]);
  const { data: snapshot } = useLocalData(snapshotLoader);

  useFocusEffect(useCallback(() => {
    let active = true;
    void isScheduleOutdated(schedule).then(v => { if (active) setOutdated(v); }).catch(() => {});
    return () => { active = false; };
  }, [schedule]));

  const dirty = JSON.stringify(blocks) !== baseline;
  useUnsavedChanges(dirty && !busy);

  function updateBlock(id: string, patch: Partial<RotationBlock>) {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }

  function updateActivityType(blockId: string, grade: number, activityType: NonNullable<RotationActivity['activityType']>) {
    const block = blocks.find(item => item.id === blockId);
    if (!block) return;
    updateBlock(blockId, { activities: block.activities.map(activity => activity.grade === grade ? { ...activity, activityType } : activity) });
  }

  async function save() {
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const next = await saveGeneralBlocks(schedule.id, blocks);
      setBlocks(next.blocks);
      setBaseline(JSON.stringify(next.blocks));
      setEditing(null);
      setMessage('Saved on device');
    } catch (e) {
      setFailed(true);
      setMessage(e instanceof Error ? e.message : 'Could not save schedule.');
    } finally {
      setBusy(false);
    }
  }

  const total = blocks.reduce((s, b) => s + b.durationMinutes, 0);

  return (
    <Screen
      topInset={false}
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            label="Start Class"
            icon="play-circle-outline"
            variant="secondary"
            onPress={() => router.push({ pathname: '/active-session', params: { scheduleId: schedule.id } })}
            style={{ flex: 1 }}
          />
          <Button
            label={busy ? 'Saving…' : 'Save'}
            disabled={busy || !dirty}
            onPress={() => void save()}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="title">Classroom Rotation Plan</AppText>
          <AppText muted>
            {schedule.selection.date} · Grades {schedule.selection.grades.join(', ')} · {schedule.selection.availableMinutes} min
          </AppText>
          <View style={styles.engineBadge}>
            <AppText variant="small" style={{ color: colors.forest, fontSize: 11, fontWeight: '700' }}>
              {schedule.engine === 'observed-evidence' ? 'Cloud Evidence Planner' : 'Local Evidence Planner'}
            </AppText>
          </View>
        </View>
      </View>

      {/* ── Warnings ── */}
      {outdated && (
        <View style={styles.outdatedBanner}>
          <AppText style={{ color: colors.attention, fontWeight: '700' }}>
            ⚡ Classroom data has changed
          </AppText>
          <AppText variant="small" style={{ color: colors.charcoal }}>
            Generate a new plan to use the latest records. Your saved activities are kept.
          </AppText>
        </View>
      )}
      {schedule.warnings.map(w => (
        <View key={w} style={styles.warningRow}>
          <AppText style={{ color: colors.attention, fontWeight: '700' }}>⚠ </AppText>
          <AppText variant="small" style={{ color: colors.attention, flex: 1 }}>{w}</AppText>
        </View>
      ))}

      <FormStatus message={message} error={failed} />
      {dirty && (
        <AppText variant="small" muted>
          Unsaved · {total}/{schedule.selection.availableMinutes} min
        </AppText>
      )}

      {/* ── Grade needs summary ── */}
      {schedule.needs && schedule.needs.length > 0 && (
        <View style={styles.needsSummary}>
          <AppText variant="subheading" style={{ marginBottom: 8 }}>Today's Focus Areas</AppText>
          <View style={styles.needsRow}>
            {schedule.needs.map(n => {
              const urgency = n.weak > n.attending / 2 ? 'high' : n.weak > 0 ? 'medium' : 'low';
              const bg = urgency === 'high' ? '#FDE8E8' : urgency === 'medium' ? '#FFF3CD' : colors.sageLight;
              const fg = urgency === 'high' ? colors.danger : urgency === 'medium' ? colors.attention : colors.forest;
              return (
                <View key={n.grade} style={[styles.needChip, { backgroundColor: bg }]}>
                  <AppText style={{ fontWeight: '800', fontSize: 13, color: fg }}>G{n.grade}</AppText>
                  <AppText style={{ fontSize: 12, color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                    {n.concept}
                  </AppText>
                  <AppText variant="small" style={{ color: fg, fontSize: 11 }}>
                    {n.weak > 0 ? `${n.weak}↓` : '✓'}
                    {n.prerequisiteGap ? ' · prerequisite support' : ''}
                  </AppText>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ── Block cards ── */}
      <View style={styles.snapshotCard}>
        <AppText variant="subheading">Before the bell</AppText>
        <AppText variant="small" muted>Present learners and the people who need your first attention.</AppText>
        {snapshot?.map(item => {
          const need = schedule.needs.find(value => value.grade === item.grade);
          const concept = item.evidence.progress.find(value => value.concept.id === need?.conceptId);
          const names = concept?.revision.map(student => student.name) ?? [];
          const present = item.attendance.filter(student => student.status === 'present' || student.status === 'late');
          return <View key={item.grade} style={styles.snapshotRow}><View style={styles.snapshotGrade}><AppText style={styles.snapshotGradeText}>G{item.grade}</AppText></View><View style={{ flex: 1, gap: 2 }}><AppText style={styles.snapshotTitle}>{present.length}/{item.attendance.length || item.evidence.students.length} present · {need?.concept ?? 'Readiness check'}</AppText><AppText variant="small" muted>{names.length ? `Attention first: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : 'No named revision group yet; use the planned check.'}</AppText></View></View>;
        })}
      </View>

      {(() => {
        let elapsed = 0;
        return blocks.map((block, index) => {
          const card = (
            <BlockCard
              key={block.id}
              block={block}
              index={index}
              needs={schedule.needs ?? []}
              editing={editing === block.id}
              busy={busy}
              total={total}
              elapsed={elapsed}
              onEdit={() => setEditing(editing === block.id ? null : block.id)}
              onUpdate={patch => updateBlock(block.id, patch)}
              onActivityType={(grade, activityType) => updateActivityType(block.id, grade, activityType)}
              onStatusChange={s => updateBlock(block.id, { status: s })}
            />
          );
          elapsed += block.durationMinutes;
          return card;
        });
      })()}

      {/* ── AI Copilot shortcut ── */}
      <Button
        label="Ask AI Copilot for Teaching Tips"
        icon="chatbubble-ellipses-outline"
        variant="quiet"
        onPress={() =>
          router.push({
            pathname: '/chatbot',
            params: { screenContext: 'pre_class', conceptId: schedule.needs?.[0]?.conceptId ?? '' },
          })
        }
      />
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.line,
    gap: 8,
  },
  engineBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.sageLight,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  outdatedBanner: {
    backgroundColor: colors.attentionSurface,
    borderLeftWidth: 4,
    borderColor: colors.attention,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  warningRow: {
    flexDirection: 'row',
    backgroundColor: colors.attentionSurface,
    borderRadius: 6,
    padding: 10,
    gap: 4,
  },
  needsSummary: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  needsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  needChip: {
    borderRadius: 10,
    padding: 10,
    gap: 2,
    minWidth: 90,
    alignItems: 'center',
  },
  blockCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 5,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  blockHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  timeBadge: {
    width: 64,
    alignItems: 'center',
    backgroundColor: colors.sageLight,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  kindRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  kindPill: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  teacherPill: {
    backgroundColor: colors.forest,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activitiesContainer: {
    gap: 8,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 10,
  },
  activityRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    alignItems: 'flex-start',
  },
  activityGuided: {
    backgroundColor: colors.sageLight,
    borderWidth: 1,
    borderColor: colors.sage,
  },
  activityIndependent: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.line,
  },
  activityGradeBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conceptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  guidedBadge: {
    backgroundColor: colors.forest,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  graphLink: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: colors.sageLight,
    borderRadius: 12,
    marginTop: 2,
  },
  blockFooter: {
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 10,
    gap: 8,
  },
  snapshotCard: { gap: 8, padding: 14, borderRadius: 14, backgroundColor: colors.paperWarm, borderWidth: 1, borderColor: colors.lineLight },
  snapshotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineLight },
  snapshotGrade: { width: 32, height: 32, borderRadius: 11, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  snapshotGradeText: { fontWeight: '900', color: colors.primary, fontSize: 12 },
  snapshotTitle: { fontWeight: '800', color: colors.charcoal },
});

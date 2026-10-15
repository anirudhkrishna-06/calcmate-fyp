/**
 * CALCMATE — Stage 4: ScheduleCard
 * frontend/src/components/ScheduleCard.tsx
 *
 * Renders a GeneralDraft (multi-grade rotation schedule) inline in the chat
 * conversation.  Compact by default with an expand toggle.  Shows a warning
 * banner for any schedule warnings, and an "Open in Planner" deep-link button.
 *
 * Does NOT persist the schedule — that is done by createGeneralSchedule() in
 * generalScheduleService.ts before this component receives the draft.
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { AppText } from "./AppText";
import { colors } from "@/theme";
import type { GeneralDraft, RotationBlock } from "@/types/generalSchedule";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gradeLabel(g: number) { return `Grade ${g}`; }

function kindLabel(kind: RotationBlock["kind"]) {
  switch (kind) {
    case "opening":     return "Opening";
    case "instruction": return "Instruction";
    case "transition":  return "Transition";
    case "closing":     return "Closing";
  }
}

function kindColor(kind: RotationBlock["kind"]) {
  switch (kind) {
    case "opening":     return colors.sageLight;
    case "instruction": return colors.forest;
    case "transition":  return colors.line;
    case "closing":     return colors.sageLight;
  }
}

function kindTextColor(kind: RotationBlock["kind"]) {
  return kind === "instruction" ? colors.white : colors.charcoal;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function BlockRow({ block, grades }: { block: RotationBlock; grades: number[] }) {
  const [expanded, setExpanded] = useState(false);
  const bg = kindColor(block.kind);
  const fg = kindTextColor(block.kind);
  const isInstruction = block.kind === "instruction";

  return (
    <View style={[styles.block, { backgroundColor: bg }]}>
      {/* Header row */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${block.durationMinutes} minute ${kindLabel(block.kind)} block. Tap to ${expanded ? "collapse" : "expand"} activities.`}
        onPress={() => setExpanded(e => !e)}
        style={styles.blockHeader}
      >
        <View style={styles.blockHeaderLeft}>
          <AppText variant="small" style={{ color: fg, fontWeight: "700" }}>
            {block.durationMinutes} min — {kindLabel(block.kind)}
            {isInstruction && block.teacherGrade != null ? ` · ${gradeLabel(block.teacherGrade)}` : ""}
          </AppText>
          {isInstruction && (
            <AppText variant="small" style={{ color: fg, opacity: 0.85 }} numberOfLines={1}>
              {block.teacherActivity}
            </AppText>
          )}
          {!isInstruction && (
            <AppText variant="small" style={{ color: fg, opacity: 0.75 }} numberOfLines={1}>
              {block.teacherActivity}
            </AppText>
          )}
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={fg}
          style={{ opacity: 0.8 }}
        />
      </Pressable>

      {/* Activities per grade (expandable) */}
      {expanded && block.kind !== "transition" && (
        <View style={styles.activitiesContainer}>
          {block.activities.map(a => (
            <View key={a.grade} style={styles.activityRow}>
              <View style={styles.gradeChip}>
                <AppText variant="small" style={styles.gradeChipText}>{gradeLabel(a.grade)}</AppText>
              </View>
              <View style={styles.activityText}>
                <AppText variant="small" style={{ color: colors.charcoal, fontWeight: "600" }} numberOfLines={1}>
                  {a.concept}
                </AppText>
                <AppText variant="small" muted numberOfLines={2}>{a.activity}</AppText>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  draft: GeneralDraft;
  savedId?: string;  // if set, enables "Open in Planner" navigation
};

export function ScheduleCard({ draft, savedId }: Props) {
  const totalMinutes = draft.blocks.reduce((s, b) => s + b.durationMinutes, 0);
  const instructionBlocks = draft.blocks.filter(b => b.kind === "instruction");
  const gradesInvolved = draft.selection.grades;

  return (
    <View style={styles.card}>
      {/* Card header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Ionicons name="calendar-outline" size={18} color={colors.forest} />
          <AppText variant="body" style={styles.cardTitle}>
            {totalMinutes}-min Multi-Grade Schedule
          </AppText>
        </View>
        <AppText variant="small" muted>
          {draft.selection.date}
        </AppText>
      </View>

      {/* Grade summary chips */}
      <View style={styles.gradeRow}>
        {gradesInvolved.map(g => (
          <View key={g} style={styles.gradeBadge}>
            <AppText variant="small" style={styles.gradeBadgeText}>
              {gradeLabel(g)}
            </AppText>
          </View>
        ))}
        <AppText variant="small" muted style={{ alignSelf: "center" }}>
          · {instructionBlocks.length} instruction slot{instructionBlocks.length !== 1 ? "s" : ""}
          · {draft.selection.priority === "learning-needs" ? "Needs-first" : "Balanced"}
        </AppText>
      </View>

      {/* Warnings */}
      {draft.warnings.length > 0 && (
        <View style={styles.warningBanner}>
          <Ionicons name="warning-outline" size={14} color={colors.attention} />
          <AppText variant="small" style={styles.warningText}>
            {draft.warnings[0]}
          </AppText>
        </View>
      )}

      {/* Needs summary */}
      <View style={styles.needsRow}>
        {draft.needs.map(n => (
          <View key={n.grade} style={styles.needCard}>
            <AppText variant="small" style={{ fontWeight: "700", color: colors.forest }}>
              {gradeLabel(n.grade)}
            </AppText>
            <AppText variant="small" muted numberOfLines={1}>{n.concept}</AppText>
            {n.weak > 0 && (
              <AppText variant="small" style={{ color: colors.attention }}>
                {n.weak}/{n.attending} need support
              </AppText>
            )}
            {n.attending === 0 && (
              <AppText variant="small" muted>All absent</AppText>
            )}
          </View>
        ))}
      </View>

      {/* Block timeline */}
      <View style={styles.blocksContainer}>
        {draft.blocks.map(b => (
          <BlockRow key={b.id} block={b} grades={gradesInvolved} />
        ))}
      </View>

      {/* Open in Planner */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open this schedule in the Planner tab"
        onPress={() => router.push("/planner" as never)}
        style={({ pressed }) => [styles.plannerButton, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Ionicons name="grid-outline" size={15} color={colors.forest} />
        <AppText variant="small" style={styles.plannerButtonText}>Open in Planner</AppText>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    marginVertical: 8,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.sageLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardTitle: {
    fontWeight: "700",
    color: colors.forest,
  },
  gradeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  gradeBadge: {
    backgroundColor: colors.forest,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  gradeBadgeText: {
    color: colors.white,
    fontWeight: "600",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginHorizontal: 14,
    marginTop: 8,
    backgroundColor: colors.attentionSurface,
    borderRadius: 8,
    padding: 8,
  },
  warningText: {
    flex: 1,
    color: colors.attention,
  },
  needsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  needCard: {
    flex: 1,
    minWidth: 100,
    backgroundColor: colors.primarySurface,
    borderRadius: 8,
    padding: 8,
    gap: 2,
  },
  blocksContainer: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 4,
    gap: 6,
  },
  block: {
    borderRadius: 8,
    overflow: "hidden",
  },
  blockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  blockHeaderLeft: {
    flex: 1,
    gap: 2,
  },
  activitiesContainer: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.08)",
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingTop: 4,
  },
  gradeChip: {
    backgroundColor: colors.forest,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    minWidth: 52,
    alignItems: "center",
  },
  gradeChipText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 11,
  },
  activityText: {
    flex: 1,
    gap: 1,
  },
  plannerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 6,
  },
  plannerButtonText: {
    color: colors.forest,
    fontWeight: "600",
  },
});


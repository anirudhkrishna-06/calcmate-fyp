/**
 * StudentRow — redesigned for Review 3.
 *
 * Layout:
 *   [Roll badge] | [Name + unit] | [Mastery bar + status chip] | [→]
 *
 * Status colours match the new theme:
 *  • Likely ready  → forest green
 *  • Practicing    → gold
 *  • Needs support → terracotta
 *  • Not assessed  → muted
 */
import { Pressable, View, StyleSheet } from "react-native";
import { Link } from "expo-router";
import { AppText } from "./AppText";
import { Student } from "@/types/domain";
import { colors, spacing } from "@/theme";

type StatusKind = "ready" | "practicing" | "revision" | "unassessed";

function getStatus(student: Student): StatusKind {
  if (student.hasEvidence === false) return "unassessed";
  if (student.needsRevision || student.mastery < 0.6) return "revision";
  if (student.mastery >= 0.8) return "ready";
  return "practicing";
}

const STATUS_CONFIG: Record<StatusKind, { label: string; color: string; bg: string }> = {
  ready:      { label: "On track",       color: colors.forest,  bg: colors.sageLight },
  practicing: { label: "Practicing",     color: colors.gold,    bg: colors.goldLight },
  revision:   { label: "Needs support",  color: colors.danger,  bg: colors.dangerLight },
  unassessed: { label: "Not assessed",   color: colors.charcoalMuted, bg: colors.lineLight },
};

export function StudentRow({ student }: { student: Student }) {
  const kind   = getStatus(student);
  const cfg    = STATUS_CONFIG[kind];
  const pct    = student.hasEvidence !== false ? Math.round(student.mastery * 100) : null;

  return (
    <Link href={`/students/${student.id}`} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${student.name}, roll ${student.rollNumber}, ${kind === "ready" ? "Secure" : cfg.label}`}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        {/* Roll badge */}
        <View style={styles.rollBadge}>
          <AppText style={styles.rollLabel}>Roll</AppText>
          <AppText style={styles.rollNumber}>{student.rollNumber}</AppText>
        </View>

        {/* Main content */}
        <View style={styles.content}>
          <AppText style={styles.name} numberOfLines={1}>{student.name}</AppText>

          {student.currentUnit && student.currentUnit !== "No assessment yet" ? (
            <AppText variant="small" style={styles.unit} numberOfLines={1}>
              {student.currentUnit}
            </AppText>
          ) : null}

          {/* Mastery bar */}
          {pct !== null && (
            <View style={styles.barRow}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${pct}%` as any,
                      backgroundColor:
                        pct >= 70 ? colors.masteryHigh :
                        pct >= 60 ? colors.masteryMid  : colors.masteryLow,
                    },
                  ]}
                />
              </View>
              <AppText style={[styles.pctLabel, { color: cfg.color }]}>{pct}%</AppText>
            </View>
          )}
        </View>

        {/* Status chip */}
        <View style={[styles.chip, { backgroundColor: cfg.bg }]}>
          <AppText style={[styles.chipText, { color: cfg.color }]}>{cfg.label}</AppText>
        </View>

        {/* Arrow */}
        <AppText style={styles.arrow}>›</AppText>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderColor: colors.lineLight,
    backgroundColor: colors.paper,
  },
  rowPressed: { backgroundColor: colors.sagePale },

  rollBadge: {
    width: 40,
    alignItems: "center",
    backgroundColor: colors.sageLight,
    borderRadius: 8,
    paddingVertical: 5,
  },
  rollLabel:  { fontSize: 10, color: colors.charcoalMuted, fontWeight: "600" },
  rollNumber: { fontSize: 15, fontWeight: "800", color: colors.forest },

  content: { flex: 1, minWidth: 0, gap: 3 },
  name:    { fontSize: 15, fontWeight: "700", color: colors.charcoal },
  unit:    { fontSize: 12, color: colors.charcoalMuted },

  barRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  barTrack: { flex: 1, height: 5, backgroundColor: colors.lineLight, borderRadius: 3, overflow: "hidden" },
  barFill:  { height: "100%", borderRadius: 3 },
  pctLabel: { fontSize: 12, fontWeight: "700", width: 32, textAlign: "right" },

  chip: {
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: "center",
  },
  chipText: { fontSize: 11, fontWeight: "700" },

  arrow: { fontSize: 22, color: colors.sage, paddingLeft: 2 },
});

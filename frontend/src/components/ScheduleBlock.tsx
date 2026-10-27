import { StyleSheet, View } from "react-native";
import { AppText } from "./AppText";
import { Card } from "./Card";
import { ScheduleItem } from "@/types/domain";
import { colors, spacing } from "@/theme";

type Props = {
  item: ScheduleItem;
};

export function ScheduleBlock({ item }: Props) {
  return (
    <Card style={styles.card}>
      <View style={styles.topLine}>
        <AppText variant="subheading" style={styles.title}>
          {item.title}
        </AppText>
        <AppText variant="small" style={styles.grade}>
          G{item.grade}
        </AppText>
      </View>
      <AppText muted>{item.focus}</AppText>
      <AppText variant="small" style={styles.meta}>
        {item.durationMinutes} min · {item.studentIds.length} students
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm
  },
  topLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  title: {
    flex: 1
  },
  grade: {
    color: colors.forest,
    backgroundColor: colors.sageLight,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  meta: {
    color: colors.charcoalMuted
  }
});

import { ReactNode } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { colors, spacing } from "@/theme";

type Props = {
  children: ReactNode;
  style?: ViewStyle;
};

export function Card({ children, style }: Props) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
    minWidth: 0
  }
});

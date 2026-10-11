import { Pressable, StyleSheet, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "./AppText";
import { colors, spacing } from "@/theme";

type Props = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "quiet";
  onPress?: () => void;
  style?: ViewStyle;
  disabled?: boolean;
  accessibilityLabel?:string;
};

export function Button({ label, icon, variant = "primary", onPress, style, disabled = false,accessibilityLabel }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel??label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && styles.pressed,
        disabled && { opacity: 0.45 },
        style
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={variant === "primary" ? colors.white : colors.forest} /> : null}
      <AppText style={[styles.label, variant === "primary" && styles.primaryLabel]}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  primary: {
    backgroundColor: colors.primary
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1
  },
  quiet: {
    backgroundColor: "transparent",
    borderWidth:1,
    borderColor:colors.primary
  },
  pressed: {
    opacity: 0.82
  },
  label: {
    flexShrink: 1,
    textAlign: "center",
    color: colors.forest,
    fontWeight: "700"
  },
  primaryLabel: {
    color: colors.white
  }
});

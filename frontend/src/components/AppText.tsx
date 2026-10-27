import { ReactNode } from "react";
import { StyleProp, StyleSheet, Text, TextStyle,TextProps } from "react-native";
import { colors, typography } from "@/theme";

type Variant = "title" | "heading" | "subheading" | "body" | "small";

type Props = Pick<TextProps,"accessibilityLiveRegion" | "numberOfLines"> & {
  children: ReactNode;
  variant?: Variant;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
};

export function AppText({ children, variant = "body", muted = false, style,accessibilityLiveRegion, numberOfLines }: Props) {
  return (
    <Text accessibilityLiveRegion={accessibilityLiveRegion} numberOfLines={numberOfLines} style={[styles.base, typography[variant], muted && styles.muted, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    color: colors.text
  },
  muted: {
    color: colors.textMuted
  }
});

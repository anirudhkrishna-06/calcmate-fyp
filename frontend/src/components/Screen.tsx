import { ReactNode } from "react";
import { KeyboardAvoidingView,Platform,ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";

type Props = {
  children: ReactNode;
  scroll?: boolean;
  topInset?:boolean;
  footer?:ReactNode;
};

export function Screen({ children, scroll = true,footer,topInset=true }: Props) {
  const content = <View style={[styles.content, !scroll && {flex:1}]}>{children}</View>;

  return (
    <SafeAreaView style={styles.safeArea} edges={topInset ? footer ? ["top", "left", "right"] : ["top", "bottom", "left", "right"] : footer ? ["left", "right"] : ["bottom", "left", "right"]}>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios" ? "padding" : "height"}>
      {scroll ? (
        <ScrollView style={{flex:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {content}
        </ScrollView>
      ) : (
        content
      )}{footer ? <SafeAreaView edges={["bottom"]} style={{borderTopWidth:1,borderColor:colors.line,paddingHorizontal:spacing.xl,paddingTop:12,paddingBottom:12}}>{footer}</SafeAreaView> : null}</KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  scrollContent: {
    flexGrow: 1
  },
  content: {
    flexGrow: 1,
    flexShrink: 0,
    width: "100%",
    maxWidth: 840,
    alignSelf: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl
  }
});

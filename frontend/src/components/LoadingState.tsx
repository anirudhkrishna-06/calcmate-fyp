import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, StyleSheet, View } from "react-native";
import { AppText } from "./AppText";
import { colors } from "@/theme";

export function LoadingState({ label = "Preparing your classroom" }: { label?: string }) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  const [dots, setDots] = useState("");
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
    ]));
    animation.start();
    const timer = setInterval(() => setDots(value => value.length === 3 ? "" : `${value}.`), 420);
    return () => { animation.stop(); clearInterval(timer); };
  }, [opacity]);
  return <View style={styles.container}><View style={styles.panel}><ActivityIndicator size="small" color={colors.primary} /><Animated.View style={{ opacity }}><AppText muted>{label}{dots}</AppText></Animated.View></View></View>;
}

const styles = StyleSheet.create({ container: { flex: 1, minHeight: 280, alignItems: "center", justifyContent: "center" }, panel: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 16, borderRadius: 16, backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.lineLight } });

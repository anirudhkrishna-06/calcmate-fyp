
import { Link, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/Button";


import { Screen } from "@/components/Screen";
import { FormStatus } from "@/components/FormStatus";
import { colors } from "@/theme";
import {
  exploreDemo,
  pendingAccount,
} from "@/services/authService";
import { useLocalData } from "@/hooks/useLocalData";

const C = {
  paper: "#F8F5EC",
  forest: colors.forest,
  ink: "#203A2E",
  muted: "#788176",
  white: "#FFFFFF",
  green: "#DDEBD6",
  yellow: "#F4D778",
  coral: "#F0A18C",
  blue: "#BBD8E9",
  lavender: "#DCD3F0",
  line: "#E8E3D7",
};

function FloatingObject({
  icon,
  background,
  size = 64,
  delay = 0,
  style,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  background: string;
  size?: number;
  delay?: number;
  style?: object;
}) {
  const motion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(motion, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(motion, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [motion, delay]);

  const translateY = motion.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -11],
  });

  const rotate = motion.interpolate({
    inputRange: [0, 1],
    outputRange: ["-5deg", "5deg"],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.floatingObject,
        {
          width: size,
          height: size,
          borderRadius: size * 0.3,
          backgroundColor: background,
          transform: [{ translateY }, { rotate }],
        },
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={size * 0.46}
        color={C.ink}
      />
    </Animated.View>
  );
}

function HelpAction({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.helpAction,
        pressed && { opacity: 0.65, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.helpIcon}>
        <Ionicons name={icon} size={19} color={C.forest} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.helpTitle}>{title}</Text>
        <Text style={styles.helpSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={C.muted} />
    </Pressable>
  );
}

export default function Welcome() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [showApproval, setShowApproval] = useState(false);

  const { data: pending } = useLocalData(pendingAccount);

  const enterDemo = async () => {
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      await exploreDemo();
      router.replace("/(tabs)");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not open demo."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.root}>
        {/* Decorative classroom backdrop */}
        <View pointerEvents="none" style={styles.artwork}>
          <View style={styles.sun} />
          <View style={styles.greenBlob} />
          <View style={styles.blueBlob} />
        </View>

        {/* Main welcome content */}
        <View style={styles.content}>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <Ionicons name="school" size={25} color={C.white} />
            </View>
            <Text style={styles.brandName}>Calcmate</Text>
            <View style={styles.brandDot} />
          </View>

          <View style={styles.headlineArea}>

            <Text style={styles.headline}>
              Every grade.
            </Text>
            <Text style={styles.headlineSecond}>
              One caring teacher.
            </Text>

            <View style={styles.underlineWrap}>
              <View style={styles.underline} />
              <Ionicons
                name="leaf"
                size={27}
                color={C.forest}
                style={{ marginLeft: 5, marginTop: -7 }}
              />
            </View>

            <Text style={styles.description}>
              A little more clarity for every classroom.
            </Text>
          </View>

          {/* First action: Login */}
          <Link href="/login" asChild>
            <Button
              label="Log in"
              icon="arrow-forward"
              onPress={() => router.push("/login")}
            />
          </Link>

          {/* Second action: Demo */}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void enterDemo()}
            style={({ pressed }) => [
              styles.demoButton,
              pressed && styles.pressed,
              busy && { opacity: 0.65 },
            ]}
          >
            <View style={styles.playIcon}>
              <Ionicons
                name={busy ? "hourglass-outline" : "play"}
                size={19}
                color={C.forest}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.demoTitle}>
                {busy ? "Opening your classroom..." : "Explore demo"}
              </Text>
              <Text style={styles.demoSubtitle}>
                Step inside · No account needed
              </Text>
            </View>
            <Ionicons
              name="arrow-forward"
              size={20}
              color={C.forest}
            />
          </Pressable>

          <Link href="/signup" asChild>
            <Button
              label="Create teacher account"
              variant="quiet"
              icon="person-add-outline"
              onPress={() => router.push("/signup")}
            />
          </Link>

          <FormStatus message={error} error />

          <View style={styles.footer}>
            <Ionicons
              name="shield-checkmark-outline"
              size={15}
              color={C.muted}
            />
            <Text style={styles.footerText}>
              A separate demo workspace with fictional students
            </Text>
          </View>
        </View>

        {/* Floating help and account drawer */}
        {helpOpen && (
          <>
            <Pressable
              accessibilityLabel="Close help menu"
              style={styles.dismissLayer}
              onPress={() => setHelpOpen(false)}
            />

            <View style={styles.helpPanel}>
              <View style={styles.helpHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.helpHeading}>Need a hand?</Text>
                  <Text style={styles.helpIntro}>
                    Your next step starts here.
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Close help"
                  onPress={() => setHelpOpen(false)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={21} color={C.ink} />
                </Pressable>
              </View>

              <View style={styles.helpDivider} />

              <HelpAction
                icon="person-add-outline"
                title="Create teacher account"
                subtitle="Get started with Calcmate"
                onPress={() => {
                  setHelpOpen(false);
                  router.push("/signup");
                }}
              />

              {pending ? (
                <HelpAction
                  icon="time-outline"
                  title="Account approval"
                  subtitle="Check your application status"
                  onPress={() => {
                    setHelpOpen(false);
                    router.push("/pending");
                  }}
                />
              ) : null}

              <HelpAction
                icon="cloud-outline"
                title="Server connection"
                subtitle="Check connectivity"
                onPress={() => {
                  setHelpOpen(false);
                  router.push("/connection");
                }}
              />
            </View>
          </>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={helpOpen ? "Close help menu" : "Help and account options"}
          accessibilityState={{ expanded: helpOpen }}
          onPress={() => setHelpOpen((open) => !open)}
          style={({ pressed }) => [
            styles.helpFab,
            pressed && { transform: [{ scale: 0.94 }] },
          ]}
        >
          <Ionicons
            name={helpOpen ? "close" : "help"}
            size={23}
            color={C.white}
          />
          {!helpOpen && <View style={styles.fabDot} />}
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.paper,
    overflow: "hidden",
    justifyContent: "center",
  },

  artwork: {
    ...StyleSheet.absoluteFill,
  },

  sun: {
    position: "absolute",
    top: "-9%",
    right: "-15%",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "#F1E8C9",
    opacity: 0.6,
  },

  greenBlob: {
    position: "absolute",
    bottom: "-13%",
    left: "-22%",
    width: 310,
    height: 270,
    borderRadius: 150,
    backgroundColor: "#E1EBDD",
    transform: [{ rotate: "-17deg" }],
  },

  blueBlob: {
    position: "absolute",
    top: "28%",
    right: "-30%",
    width: 180,
    height: 250,
    borderRadius: 100,
    backgroundColor: "#E8EEF0",
    opacity: 0.65,
    transform: [{ rotate: "25deg" }],
  },

  floatingObject: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.8)",
    shadowColor: "#33483A",
    shadowOpacity: 0.13,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },

  doodleStar: {
    position: "absolute",
    top: "25%",
    right: "19%",
  },

  doodleDot: {
    position: "absolute",
    top: "19%",
    left: "23%",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.coral,
  },

  doodleDotTwo: {
    position: "absolute",
    bottom: "20%",
    left: "14%",
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: C.yellow,
  },

  content: {
    zIndex: 2,
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 27,
    paddingVertical: -66,
  },

  brand: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 9,
    marginBottom: 37,
  },

  brandMark: {
    width: 39,
    height: 39,
    borderRadius: 14,
    backgroundColor: C.forest,
    justifyContent: "center",
    alignItems: "center",
    transform: [{ rotate: "-5deg" }],
  },

  brandName: {
    color: C.ink,
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: -1.1,
  },

  brandDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#E5B84D",
    alignSelf: "flex-start",
    marginTop: 4,
  },

  headlineArea: {
    alignItems: "center",
    width: "100%",
    marginBottom: 29,
  },

  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2.1,
    color: C.forest,
    marginBottom: 18,
  },

  headline: {
    fontSize: 37,
    lineHeight: 43,
    fontWeight: "800",
    color: C.ink,
    letterSpacing: -1.8,
    textAlign: "center",
  },

  headlineSecond: {
    fontSize: 31,
    lineHeight: 39,
    fontWeight: "500",
    color: C.forest,
    letterSpacing: -1.5,
    textAlign: "center",
  },

  underlineWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 7,
  },

  underline: {
    width: 112,
    height: 4,
    borderRadius: 3,
    backgroundColor: C.yellow,
    transform: [{ rotate: "-1deg" }],
  },

  description: {
    marginTop: 17,
    color: C.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },

  loginButton: {
    width: "100%",
    minHeight: 60,
    borderRadius: 19,
    backgroundColor: C.forest,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingLeft: 24,
    paddingRight: 9,
    shadowColor: C.forest,
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },

  loginText: {
    flex: 1,
    textAlign: "center",
    color: C.white,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
    paddingLeft: 38,
  },

  loginArrow: {
    width: 41,
    height: 41,
    borderRadius: 14,
    backgroundColor: "#DDEBD6",
    alignItems: "center",
    justifyContent: "center",
  },

  demoButton: {
    width: "100%",
    minHeight: 76,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.83)",
    borderWidth: 1,
    borderColor: "#E7E4D9",
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 15,
    marginTop: 12,
  },

  playIcon: {
    width: 43,
    height: 43,
    borderRadius: 15,
    backgroundColor: "#F4E5AD",
    alignItems: "center",
    justifyContent: "center",
  },

  demoTitle: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "700",
  },

  demoSubtitle: {
    color: C.muted,
    fontSize: 10,
    marginTop: 5,
  },

  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 20,
    paddingHorizontal: 5,
  },

  footerText: {
    fontSize: 10,
    lineHeight: 15,
    color: C.muted,
    textAlign: "center",
    flexShrink: 1,
  },

  helpFab: {
    position: "absolute",
    zIndex: 20,
    right: 20,
    bottom: 20,
    width: 54,
    height: 54,
    borderRadius: 19,
    backgroundColor: C.forest,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#243B2D",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },

  fabDot: {
    position: "absolute",
    top: 11,
    right: 11,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.yellow,
    borderWidth: 1,
    borderColor: C.forest,
  },

  dismissLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    backgroundColor: "rgba(30,43,33,0.12)",
  },

  helpPanel: {
    position: "absolute",
    zIndex: 15,
    right: 16,
    bottom: 86,
    width: 300,
    maxWidth: "90%",
    padding: 17,
    borderRadius: 23,
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: "#243B2D",
    shadowOpacity: 0.17,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 9 },
    elevation: 12,
  },

  helpHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 14,
  },

  helpHeading: {
    color: C.ink,
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.5,
  },

  helpIntro: {
    color: C.muted,
    fontSize: 11,
    marginTop: 4,
  },

  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#F0EFE7",
    justifyContent: "center",
    alignItems: "center",
  },

  helpDivider: {
    height: 1,
    backgroundColor: C.line,
    marginBottom: 5,
  },

  helpAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 12,
  },

  helpIcon: {
    width: 39,
    height: 39,
    borderRadius: 13,
    backgroundColor: "#EAF0E5",
    justifyContent: "center",
    alignItems: "center",
  },

  helpTitle: {
    color: C.ink,
    fontSize: 12,
    fontWeight: "700",
  },

  helpSubtitle: {
    color: C.muted,
    fontSize: 10,
    marginTop: 4,
  },
});


import { useEffect, useRef, useState } from "react";
import { Link, router } from "expo-router";
import {
  Animated,
  Easing,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { FormStatus } from "@/components/FormStatus";
import { AccountGate } from "@/components/AccountGate";
import { ApiError } from "@/services/apiClient";
import { signIn } from "@/services/authService";

const C = {
  paper: "#F8F5EC",
  forest: "#294C38",
  ink: "#203A2E",
  muted: "#788176",
  white: "#FFFFFF",
  yellow: "#F4D778",
  coral: "#F0A18C",
  blue: "#BBD8E9",
  lavender: "#DCD3F0",
  line: "#E8E3D7",
};

function FloatingObject({
  icon,
  background,
  size = 60,
  delay = 0,
  duration = 2200,
  style,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  background: string;
  size?: number;
  delay?: number;
  duration?: number;
  style?: object;
}) {
  const motion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(motion, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(motion, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [motion, delay, duration]);

  const translateY = motion.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -10],
  });

  const rotate = motion.interpolate({
    inputRange: [0, 1],
    outputRange: ["-6deg", "6deg"],
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

function LoginArtwork() {
  return (
    <View style={styles.artwork}>
      <View style={styles.artCircle} />
      <View style={styles.artCircleInner} />

      <FloatingObject
        icon="book"
        background={C.coral}
        size={75}
        delay={100}
        style={{
          position: "absolute",
          left: "9%",
          top: "29%",
        }}
      />

      <FloatingObject
        icon="pencil"
        background={C.yellow}
        size={57}
        delay={450}
        style={{
          position: "absolute",
          right: "13%",
          top: "14%",
        }}
      />

      <FloatingObject
        icon="calculator"
        background={C.blue}
        size={67}
        delay={750}
        style={{
          position: "absolute",
          right: "5%",
          bottom: "8%",
        }}
      />

      <FloatingObject
        icon="shapes"
        background={C.lavender}
        size={52}
        delay={300}
        style={{
          position: "absolute",
          left: "18%",
          bottom: "6%",
        }}
      />

      <View style={styles.schoolBadge}>
        <Ionicons name="school" size={48} color={C.white} />
      </View>

      

      <View style={styles.artDot} />
      <View style={styles.artDotTwo} />

      
    </View>
  );
}

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login() {
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      await signIn(email, password);
      router.replace("/(tabs)");
    } catch (e) {
      if (e instanceof ApiError && e.code === "pending-approval") {
        router.replace("/pending");
        return;
      }

      setError(
        e instanceof Error ? e.message : "Unable to log in."
      );
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <Screen>
      <View style={styles.root}>
        <View style={styles.topBar}>
          <View style={styles.logo}>
            <Ionicons name="school" size={23} color={C.white} />
          </View>

          <AppText variant="title">calcmate</AppText>

          <View style={styles.logoDot} />
        </View>

        <LoginArtwork />

        <View style={styles.heading}>
          <AppText variant="title">Good to see you.</AppText>

          <AppText variant="small" muted>
            Let's get your classroom ready.
          </AppText>
        </View>

        <AccountGate>
          <View style={styles.form}>
            <TextField
              label="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />

            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              maxLength={128}
            />

            <View style={styles.submit}>
              <Button
                label={busy ? "Signing you in..." : "Log in"}
                disabled={busy || !email.trim() || !password}
                onPress={() => void login()}
              />
            </View>

            <FormStatus message={error} error />

            <View style={styles.separator}>
              <View style={styles.separatorLine} />

              <AppText variant="small" muted>
                NEW TO CALCMATE?
              </AppText>

              <View style={styles.separatorLine} />
            </View>

            <Link href="/signup" asChild>
              <Button
                label="Create a teacher account"
                variant="secondary"
                icon="person-add-outline"
              />
            </Link>

            <Link href="/welcome" asChild>
              <Button
                label=""
                variant="secondary"
                icon="arrow-back-outline"
              />
            </Link>
          </View>
        </AccountGate>

        <View style={styles.footer}>
          <Ionicons
            name="leaf-outline"
            size={15}
            color={C.muted}
          />

          <AppText variant="small" muted>
            A little more clarity for every classroom.
          </AppText>
        </View>

        <View pointerEvents="none" style={styles.background}>
          <View style={styles.backgroundSun} />
          <View style={styles.backgroundBlob} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.paper,
    paddingHorizontal: 25,
    paddingVertical: 18,
    justifyContent: "center",
    overflow: "hidden",
  },

  background: {
    ...StyleSheet.absoluteFill,
    zIndex: -1,
  },

  backgroundSun: {
    position: "absolute",
    top: -105,
    right: -100,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "#F1E8C9",
    opacity: 0.55,
  },

  backgroundBlob: {
    position: "absolute",
    bottom: -120,
    left: -110,
    width: 270,
    height: 250,
    borderRadius: 135,
    backgroundColor: "#E1EBDD",
    opacity: 0.75,
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 5,
  },

  logo: {
    width: 39,
    height: 39,
    borderRadius: 14,
    backgroundColor: C.forest,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-5deg" }],
  },

  logoDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#E5B84D",
    alignSelf: "flex-start",
    marginTop: 3,
    marginLeft: -7,
  },

  artwork: {
    width: "100%",
    height: 192,
    alignSelf: "center",
    position: "relative",
    marginTop: 4,
    marginBottom: 5,
  },

  artCircle: {
    position: "absolute",
    width: 154,
    height: 154,
    borderRadius: 77,
    backgroundColor: "#E5EBDD",
    alignSelf: "center",
    top: 10,
  },

  artCircleInner: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#D2E1CC",
    alignSelf: "center",
    top: 27,
  },

  floatingObject: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
    shadowColor: "#33483A",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },

  schoolBadge: {
    position: "absolute",
    width: 83,
    height: 83,
    borderRadius: 28,
    backgroundColor: C.forest,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    top: 44,
    shadowColor: C.forest,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
    transform: [{ rotate: "-4deg" }],
  },

  artSparkle: {
    position: "absolute",
    top: 18,
    left: "29%",
  },

  artDot: {
    position: "absolute",
    top: 39,
    right: "24%",
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: C.coral,
  },

  artDotTwo: {
    position: "absolute",
    bottom: 27,
    left: "40%",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.yellow,
  },

  artCaption: {
    position: "absolute",
    bottom: -2,
    alignSelf: "center",
  },

  heading: {
    alignItems: "center",
    gap: 8,
    marginTop: 7,
    marginBottom: 23,
  },

  form: {
    gap: 14,
  },

  submit: {
    marginTop: 5,
  },

  separator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginVertical: 5,
  },

  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.line,
  },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 20,
    paddingBottom: 3,
  },
});

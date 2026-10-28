import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Animated,
  Easing,
  
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { AssistantMessage } from "@/components/AssistantMessage";
import { ScheduleCard } from "@/components/ScheduleCard";
import { colors } from "@/theme";
import { Conversation, ChatMessage, RagChunk, RescheduleAction } from "@/types/chat";
import type { GeneralSchedule } from "@/types/generalSchedule";
import {
  listConversations,
  createConversation,
  getOrCreateStudentConversation,
  selectConversation,
  restoreConversation,
  conversationMessages,
  sendMessage,
  retryMessage,
} from "@/services/chatService";
import { apiBaseUrl } from "@/services/ragClient";
import { useGrade } from "@/hooks/useGrade";
import { chatErrorSummary } from "@/services/chatPresentation";
import { applyReschedulePlan } from "@/services/rescheduleService";

/* ---------- Design tokens: ivory, deep forest, antique gold ---------- */
const P = {
  bg: "#FAF8F3",
  card: "#FFFFFF",
  ink: "#1C2B23",
  body: "#2E3D35",
  muted: "#7C847D",
  line: "#ECE7DB",
  forest: colors.forest,
  gold: "#B8924A",
  goldSoft: "#F3EBD7",
  sage: "#EEF2EA",
  danger: "#B5483A",
  disabled: "#D8D5CA",
};
const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "serif" });

const gradePrompts: Record<number, string[]> = {
  1: [
    "How do I introduce counting up to 20 using concrete objects?",
    "Suggest a hands-on activity for number sequence and comparing lengths",
    "What is still pending to cover in Grade 1?",
    "Who needs more attention in Grade 1 today?"
  ],
  2: [
    "Explain tens and ones using bundled sticks of 10",
    "Who is struggling with place value in Grade 2?",
    "How to teach two-digit addition with regrouping?",
    "What should I teach next for Grade 2?"
  ],
  3: [
    "Explain multiplication using equal groups and arrays",
    "Who needs more attention in Grade 3 today?",
    "What concepts are still pending in Grade 3?",
    "Generate an instructional rotation schedule"
  ],
  4: [
    "Who is struggling with fractions in Grade 4?",
    "Why are students struggling with equivalent fractions?",
    "Suggest a concrete teaching activity for equivalent fractions",
    "What is the schedule ahead for our multi-grade class?"
  ],
  5: [
    "Explain decimals using a metric place-value chart",
    "Compare fractions with different denominators",
    "Who needs support in Grade 5 measurement and area?",
    "What topics are still pending in Grade 5?"
  ],
};

const EMPTY_COLORS = {
    forest: "#294C38",
    sage: "#DDEBD6",
    yellow: "#F4D778",
    coral: "#F0A18C",
    blue: "#BBD8E9",
    lavender: "#DCD3F0",
    muted: "#788176",
  };

function IconAction({
  name,
  label,
  onPress,
  disabled = false,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        { opacity: disabled ? 0.35 : 1 },
        pressed && { backgroundColor: P.sage },
      ]}
    >
      <Ionicons name={name} size={21} color={P.ink} />
    </Pressable>
  );
}

function Mark({ size = 28 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.34,
        backgroundColor: P.forest,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name="chatbubble-outline" size={size * 0.5} color="#E8C97A" />
    </View>
  );
}

function Sources({ json }: { json: string }) {
  const [expanded, setExpanded] = useState(false);
  let sources: RagChunk[] = [];
  try {
    sources = JSON.parse(json);
  } catch {
    return null;
  }
  if (!sources.length) return null;
  const names = [...new Set(sources.map((s) => s.source_pdf))];
  return (
    <View style={{ marginTop: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View retrieved sources"
        onPress={() => setExpanded(!expanded)}
        style={styles.sourcesToggle}
      >
        <Ionicons name="document-text-outline" size={14} color={P.gold} />
        <Text style={styles.sourcesToggleText}>
          {names.length} source{names.length === 1 ? "" : "s"}
        </Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={13} color={P.muted} />
      </Pressable>
      {expanded
        ? sources.map((source, index) => (
            <View key={`${source.chunk_id}-${index}`} style={styles.source}>
              <AppText variant="small">
                {source.source_pdf} | Grade {source.grade}
                {source.source_pages ? ` | Pages ${source.source_pages}` : ""}
                {source.resource_kind === "source_summary"
                  ? " | Source summary"
                  : source.resource_kind === "textbook_excerpt"
                  ? " | Textbook excerpt"
                  : ""}
              </AppText>
              {source.source_url?.startsWith("https://ncert.nic.in/textbook/pdf/") ? (
                <Button
                  label="Open NCERT source"
                  variant="quiet"
                  onPress={() => void Linking.openURL(source.source_url!).catch(() => {})}
                />
              ) : null}
              {source.used_fallback ? (
                <AppText variant="small" muted>
                  Retrieved outside the selected grade filter.
                </AppText>
              ) : null}
              <Text selectable style={styles.sourceText}>
                {source.text}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

function RescheduleCard({ action }: { action: RescheduleAction }) {
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function apply() {
    if (applied || busy) return;
    setBusy(true); setError("");
    try { await applyReschedulePlan(action); setApplied(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save this reschedule."); }
    finally { setBusy(false); }
  }
  return (
    <View style={styles.rescheduleCard}>
      <View style={styles.rescheduleHeader}>
        <View style={styles.rescheduleTitleRow}>
          <Ionicons name="calendar-clear-outline" size={18} color={P.forest} />
          <Text style={styles.rescheduleTitle}>Reschedule proposal</Text>
        </View>
        <Text style={styles.rescheduleMeta}>{action.leave_date} to {action.rescheduled_date}</Text>
      </View>
      <View style={styles.rescheduleSection}>
        <Text style={styles.rescheduleLabel}>Leave day</Text>
        <Text style={styles.rescheduleBody}>Independent peer practice and consolidation only. No direct teacher instruction is scheduled.</Text>
        {action.leave_day_tasks.slice(0, 5).map((task, index) => (
          <Text key={`${task.grade}-${task.concept_id ?? index}`} style={styles.rescheduleItem}>Grade {task.grade}: {task.concept}</Text>
        ))}
      </View>
      <View style={styles.rescheduleSection}>
        <Text style={styles.rescheduleLabel}>Return day priority</Text>
        {action.rescheduled_slots.slice(0, 5).map((slot, index) => (
          <Text key={`${slot.grade}-${slot.concept_id ?? index}`} style={styles.rescheduleItem}>Grade {slot.grade}: {slot.concept} · {slot.duration_minutes} min</Text>
        ))}
      </View>
      <Button
        label={applied ? "Saved to timetable" : busy ? "Saving..." : "Apply reschedule to timetable"}
        accessibilityLabel={applied ? "Reschedule saved to timetable" : "Apply reschedule to timetable"}
        icon={applied ? "checkmark-circle-outline" : "save-outline"}
        variant={applied ? "secondary" : "primary"}
        disabled={applied || busy}
        onPress={() => void apply()}
      />
      {error ? <Text style={styles.rescheduleError}>{error}</Text> : null}
    </View>
  );
}

export default function ChatbotScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const params = useLocalSearchParams<{
    grade?: string;
    prompt?: string;
    studentId?: string;
    studentName?: string;
    studentThread?: string;
    conceptId?: string;
    screenContext?: string;
  }>();
  const { grade, setGrade, error: gradeError } = useGrade(Number(params.grade));
  const prompts = gradePrompts[grade];
  const studentMode = Boolean(params.studentId && params.studentThread === "true");
  const studentName = params.studentName || "Student";
  const contextualDraft = useRef("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [pendingConversation, setPendingConversation] = useState<string | null>(null);
  const [legacyOpen, setLegacyOpen] = useState<Record<string, boolean>>({});
  const list = useRef<FlatList<ChatMessage>>(null);
  const composer = useRef<TextInput>(null);
  const active = useRef<string | null>(null);
  const operation = useRef(false);
  const drafts = useRef<Record<string, string>>({});
  const scroll = useRef(true);
  const mounted = useRef(true);
  let configured = false;
  try {
    configured = !!apiBaseUrl();
  } catch {
    /* Invalid config is reported by the send service. */
  }
  const scrollToEnd = useCallback(() => {
    if (scroll.current) list.current?.scrollToEnd({ animated: true });
  }, []);
  const refresh = useCallback(async (id: string) => {
    const [rows, conversations] = await Promise.all([conversationMessages(id), listConversations()]);
    if (!mounted.current) return;
    setHistory(conversations);
    if (active.current === id) {
      setMessages(rows);
      setConversation(conversations.find((c) => c.id === id) ?? null);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (active.current) void refresh(active.current).catch(() => setError("Could not reload saved conversation."));
    }, [refresh])
  );
  useEffect(() => {
    mounted.current = true;
    (studentMode && params.studentId
      ? getOrCreateStudentConversation(params.studentId, studentName, Number(params.grade) || grade)
      : restoreConversation())
      .then(async (c) => {
        if (!mounted.current) return;
        active.current = c.id;
        setConversation(c);
        await refresh(c.id);
      })
      .catch((e) => {
        if (mounted.current) setError(e instanceof Error ? e.message : "Could not open saved chat.");
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false);
    });
    const keyboard = Keyboard.addListener("keyboardDidShow", scrollToEnd);
    return () => {
      mounted.current = false;
      unsubscribe();
      keyboard.remove();
    };
  }, [refresh, scrollToEnd, studentMode, params.studentId, params.studentName, params.grade]);
  useEffect(() => {
    if (!loading && params.prompt && contextualDraft.current !== params.prompt) {
      contextualDraft.current = params.prompt;
      setDraft(params.prompt);
      if (active.current) drafts.current[active.current] = params.prompt;
      composer.current?.focus();
    }
  }, [loading, params.prompt]);
  async function switchTo(c: Conversation) {
    setHistoryOpen(false);
    setGradeOpen(false);
    setError("");
    scroll.current = true;
    setLoading(true);
    active.current = c.id;
    setConversation(c);
    setGrade(c.grade);
    setDraft(drafts.current[c.id] ?? "");
    setMessages([]);
    try {
      await selectConversation(c.id);
      await refresh(c.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load chat.");
    } finally {
      setLoading(false);
    }
  }
  async function newChat() {
    try {
      await switchTo(await createConversation(grade));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create chat.");
    }
  }
  function changeDraft(value: string) {
    setDraft(value);
    if (active.current) drafts.current[active.current] = value;
  }
  async function submit(retryId?: string) {
    if (operation.current || !conversation || (!retryId && !draft.trim())) return;
    const id = conversation.id;
    const text = draft;
    const selectedGrade = grade;
    operation.current = true;
    setBusy(true);
    setPendingConversation(id);
    setError("");
    scroll.current = true;
    const saved = async () => {
      if (!retryId) {
        drafts.current[id] = "";
        if (active.current === id) setDraft("");
      }
      await refresh(id);
    };
    // Context follows the selected conversation, including chats from history.
    // A topic supplied by the profile shortcut applies only to its first prompt.
    const initialPrompt = messages.length === 0 && text.trim() === params.prompt?.trim();
    const context = {
      student_id: conversation.student_id ?? undefined,
      concept_id: initialPrompt ? params.conceptId : undefined,
      screen_context: conversation.student_id ? "student_copilot" : undefined,
    };
    try {
      if (retryId) await retryMessage(retryId, saved);
      else await sendMessage(id, text, selectedGrade, saved, undefined, context);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Chat could not be saved.");
    } finally {
      operation.current = false;
      if (mounted.current) {
        setBusy(false);
        setPendingConversation(null);
        try {
          await refresh(active.current ?? id);
        } catch {
          setError("Unable to reload saved messages.");
        }
      }
    }
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    if (item.role === "teacher")
      return (
        <View style={styles.userRow}>
          <View style={styles.userBubble}>
            <Text selectable style={styles.userText}>
              {item.text}
            </Text>
          </View>
          {item.status === "failed" ? (
            <View style={styles.failed}>
              <AppText variant="small" muted>
                {chatErrorSummary(item.error)}
              </AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry failed question"
                  disabled={busy || messages.some((m) => m.status === "pending")}
                  onPress={() => void submit(item.id)}
                  style={styles.retry}
                >
                  <Ionicons name="refresh-outline" size={15} color={P.forest} />
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
                <Button
                  label="Check connection"
                  accessibilityLabel="Check AI connection"
                  icon="link-outline"
                  variant="secondary"
                  onPress={() => router.push("/connection")}
                />
              </View>
            </View>
          ) : null}
        </View>
      );
    if (
      item.conversation_id?.startsWith("legacy-") &&
      item.text.startsWith("The local RAG pipeline exists as Python")
    )
      return (
        <View style={styles.assistantRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setLegacyOpen((old) => ({ ...old, [item.id]: !old[item.id] }))}
          >
            <AppText variant="small" muted>
              Earlier service notice (not an AI answer) {legacyOpen[item.id] ? "-" : "+"}
            </AppText>
          </Pressable>
          {legacyOpen[item.id] ? (
            <Text selectable style={styles.sourceText}>
              {item.text}
            </Text>
          ) : null}
        </View>
      );
    let scheduleDraft: GeneralSchedule | null = null;
    let intentName: string | null = null;
    let nextStep: string | null = null;
    let reschedule: RescheduleAction | null = null;
    if (item.request_json) {
      try {
        const meta = JSON.parse(item.request_json);
        if (meta?.schedule && meta.schedule.kind === "general-schedule") {
          scheduleDraft = meta.schedule as GeneralSchedule;
        }
        if (typeof meta?.intent === "string" && meta.intent) {
          intentName = meta.intent;
        }
        if (typeof meta?.recommended_next_step === "string" && meta.recommended_next_step) {
          nextStep = meta.recommended_next_step;
        }
        if (meta?.reschedule?.action === "reschedule_plan") reschedule = meta.reschedule as RescheduleAction;
      } catch {
        /* Ignore non-schedule metadata */
      }
    }
    return (
      <View style={styles.assistantRow}>
        <View style={styles.assistantHead}>
          <Mark size={24} />
          <Text style={styles.assistantName}>Calcmate</Text>
          {intentName && intentName !== "general_question" ? (
            <View style={styles.intentBadge}>
              <Text style={styles.intentBadgeText}>
                {intentName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.assistantBody}>
          <AssistantMessage text={item.text} onResize={scrollToEnd} />
          {nextStep ? (
            <View style={styles.nextStepCard}>
              <Ionicons name="chatbubble-outline" size={14} color={P.gold} />
              <Text style={styles.nextStepText}>{nextStep}</Text>
            </View>
          ) : null}
          {scheduleDraft ? <ScheduleCard draft={scheduleDraft} savedId={scheduleDraft.id} /> : null}
          {reschedule ? <RescheduleCard action={reschedule} /> : null}
          <Sources json={item.sources_json} />
        </View>
      </View>
    );
  }

  const pending = messages.some((m) => m.status === "pending");
  const canSend = !(busy || pending || !draft.trim() || loading);

  

function EmptyFloatingItem({
  icon,
  color,
  size,
  style,
  delay = 0,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
  size: number;
  style?: object;
  delay?: number;
}) {
  const motion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(motion, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(motion, {
          toValue: 0,
          duration: 1800,
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
    outputRange: [0, -10],
  });

  const rotate = motion.interpolate({
    inputRange: [0, 1],
    outputRange: ["-8deg", "8deg"],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        emptyStyles.floatingItem,
        {
          width: size,
          height: size,
          borderRadius: size * 0.3,
          backgroundColor: color,
          transform: [{ perspective: 700 }, { translateY }, { rotate }],
        },
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={size * 0.46}
        color={EMPTY_COLORS.forest}
      />
    </Animated.View>
  );
}

function EmptyTypingTitle() {
  const [text, setText] = useState("");
  const cursorOpacity = useRef(new Animated.Value(1)).current;
  const title = "What are we teaching today?";

  useEffect(() => {
    let index = 0;

    const timer = setInterval(() => {
      index += 1;
      setText(title.slice(0, index));

      if (index >= title.length) {
        clearInterval(timer);
      }
    }, 65);

    const cursorAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(cursorOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );

    cursorAnimation.start();

    return () => {
      clearInterval(timer);
      cursorAnimation.stop();
    };
  }, [cursorOpacity]);

  return (
    <View style={emptyStyles.titleRow}>
      <Text style={emptyStyles.emptyTitle}>{text}</Text>
      <Animated.View
        style={[
          emptyStyles.cursor,
          { opacity: cursorOpacity },
        ]}
      />
    </View>
  );
}

function EmptyClassroomArtwork() {
  const bookMotion = useRef(new Animated.Value(0)).current;
  const sparkleMotion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bookAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(bookMotion, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bookMotion, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    const sparkleAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleMotion, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(sparkleMotion, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    bookAnimation.start();
    sparkleAnimation.start();

    return () => {
      bookAnimation.stop();
      sparkleAnimation.stop();
    };
  }, [bookMotion, sparkleMotion]);

  const bookY = bookMotion.interpolate({
    inputRange: [0, 1],
    outputRange: [4, -9],
  });

  const sparkleScale = sparkleMotion.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1.15],
  });

  return (
    <View style={emptyStyles.artwork}>
      <View style={emptyStyles.halo} />
      <View style={emptyStyles.haloInner} />

      <Animated.View
        style={[
          emptyStyles.books,
          {
            transform: [
              { translateY: bookY },
              { perspective: 700 },
              { rotate: "-7deg" },
            ],
          },
        ]}
      >
        <View style={[emptyStyles.book, emptyStyles.bookBack]}>
          <View style={emptyStyles.bookPages} />
        </View>

        <View style={[emptyStyles.book, emptyStyles.bookMiddle]}>
          <View style={emptyStyles.bookPages} />
        </View>

        <View style={[emptyStyles.book, emptyStyles.bookFront]}>
          <View style={emptyStyles.bookStripe} />
          <View style={emptyStyles.bookPages} />
        </View>
      </Animated.View>

      <EmptyFloatingItem
        icon="pencil"
        color={EMPTY_COLORS.yellow}
        size={51}
        delay={150}
        style={{ position: "absolute", top: 9, right: "15%" }}
      />

      <EmptyFloatingItem
        icon="calculator"
        color={EMPTY_COLORS.blue}
        size={53}
        delay={450}
        style={{ position: "absolute", bottom: 9, right: "8%" }}
      />

      <EmptyFloatingItem
        icon="shapes"
        color={EMPTY_COLORS.coral}
        size={46}
        delay={300}
        style={{ position: "absolute", bottom: 13, left: "9%" }}
      />

      <Animated.View
        style={[
          emptyStyles.sparkle,
          { transform: [{ scale: sparkleScale }] },
        ]}
      >
        <Ionicons name="chatbubble-outline" size={25} color="#D6A82D" />
      </Animated.View>

      <View style={emptyStyles.star}>
        <Ionicons name="ellipse" size={13} color={EMPTY_COLORS.coral} />
      </View>
    </View>
  );
}

  return (
    <SafeAreaView style={styles.safe} edges={embedded ? ["top", "left", "right"] : ["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {!embedded ? (
              <IconAction name="chevron-back" label="Back" onPress={() => router.back()} />
            ) : (
              <IconAction name="time-outline" label="Conversation history" onPress={() => { Keyboard.dismiss(); setHistoryOpen(true); }} />
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Select teaching grade"
            onPress={() => setGradeOpen(!gradeOpen)}
            style={styles.headerTitle}
          >
            <Text style={styles.title}>Calcmate</Text>
            <View style={styles.gradePill}>
              <Text style={styles.gradePillText}>Grade {grade} · Maths</Text>
              <Ionicons name={gradeOpen ? "chevron-up" : "chevron-down"} size={11} color={P.gold} />
            </View>
          </Pressable>

          <View style={[styles.headerSide, { justifyContent: "flex-end" }]}>
            {!embedded ? (
              <IconAction name="time-outline" label="Conversation history" onPress={() => { Keyboard.dismiss(); setHistoryOpen(true); }} />
            ) : null}
            <IconAction name="create-outline" label="New chat" onPress={() => void newChat()} disabled={loading} />
          </View>
        </View>

        {/* Grade picker */}
        {gradeOpen ? (
          <View style={styles.grades}>
            {[1, 2, 3, 4, 5].map((g) => {
              const selected = grade === g;
              return (
                <Pressable
                  key={g}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setGrade(g);
                    setGradeOpen(false);
                  }}
                  style={[styles.grade, selected && styles.gradeSelected]}
                >
                  <Text style={[styles.gradeText, selected && styles.gradeTextSelected]}>Grade {g}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {conversation?.student_id ? (
          <View style={styles.studentModeBanner}>
            <Mark size={22} />
            <View style={{ flex: 1 }}>
              <Text style={styles.studentModeTitle}>{conversation.title}</Text>
              <Text style={styles.studentModeSubtitle}>Grounded in this learner's live classroom evidence</Text>
            </View>
            <Ionicons name="person-circle-outline" size={22} color={P.gold} />
          </View>
        ) : null}

        {/* Notices */}
        {offline || !configured ? (
          <View style={styles.notice}>
            <Ionicons name="cloud-offline-outline" size={16} color={P.gold} />
            <Text style={styles.noticeText}>
              {offline ? "Offline. Saved chats remain available." : "Connect your school server for AI answers."}
            </Text>
            <Button
              label="Connect"
              accessibilityLabel="Set up AI connection"
              variant="secondary"
              onPress={() => router.push("/connection")}
            />
          </View>
        ) : null}
        {error || gradeError ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error || gradeError}
          </Text>
        ) : null}

        {/* Conversation */}
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={P.forest} />
            <Text style={styles.loadingText}>Opening conversation…</Text>
          </View>
        ) : (
          <FlatList
            ref={list}
            style={styles.flex}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            initialNumToRender={6}
            maxToRenderPerBatch={4}
            windowSize={5}
            removeClippedSubviews={false}
            contentContainerStyle={styles.chatContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onContentSizeChange={scrollToEnd}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              scroll.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 100;
            }}
            scrollEventThrottle={80}
            ListEmptyComponent={
              <View style={styles.empty}>
                <EmptyClassroomArtwork />

                <EmptyTypingTitle />

                <Text style={emptyStyles.subtitle}>
                  Curriculum- & Knowledge-State-Aware Teacher Copilot
                </Text>

                <View style={styles.promptList}>
                  {prompts.map((p, idx) => (
                    <Pressable
                      key={idx}
                      accessibilityRole="button"
                      onPress={() => {
                        changeDraft(p);
                        composer.current?.focus();
                      }}
                      style={({ pressed }) => [
                        styles.prompt,
                        pressed && { backgroundColor: P.sage, transform: [{ scale: 0.98 }] },
                      ]}
                    >
                      <Ionicons name="bulb-outline" size={17} color={P.gold} />
                      <Text style={styles.promptText}>{p}</Text>
                      <Ionicons name="arrow-forward" size={14} color={P.muted} />
                    </Pressable>
                  ))}
                </View>
              </View>
            }
            ListFooterComponent={
              pending ? (
                <View accessibilityLiveRegion="polite" style={styles.typing}>
                  <ActivityIndicator size="small" color={P.gold} />
                  <Text style={styles.typingText}>Calcmate is thinking…</Text>
                </View>
              ) : null
            }
          />
        )}

        {pendingConversation && pendingConversation !== conversation?.id ? (
          <AppText variant="small" muted style={styles.waiting}>
            Another conversation is waiting for a response.
          </AppText>
        ) : null}

        {/* Composer */}
        <View style={styles.composerArea}>
          <View style={styles.composerBox}>
            <TextInput
              ref={composer}
              testID="chat-composer"
              accessibilityLabel="Teacher question"
              multiline
              value={draft}
              onChangeText={changeDraft}
              placeholder="Ask about teaching Maths…"
              placeholderTextColor="#A5AAA3"
              maxLength={2000}
              style={styles.input}
              textAlignVertical="center"
              editable={!loading}
            />
            <Pressable
              testID="chat-send"
              accessibilityRole="button"
              accessibilityLabel="Send question"
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={() => void submit()}
              style={({ pressed }) => [
                styles.send,
                !canSend && styles.sendDisabled,
                pressed && canSend && { opacity: 0.85, transform: [{ scale: 0.95 }] },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="arrow-up" size={20} color={canSend ? "#F3E2AE" : "#FFFFFF"} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* History */}
      <Modal visible={historyOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setHistoryOpen(false)}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyHeading}>Conversations</Text>
            <IconAction name="close" label="Close history" onPress={() => setHistoryOpen(false)} />
          </View>
          <Pressable style={styles.historyNew} onPress={() => void newChat()} accessibilityRole="button">
            <View style={styles.historyNewIcon}>
              <Ionicons name="add" size={18} color="#F3E2AE" />
            </View>
            <Text style={styles.historyNewText}>New chat</Text>
          </Pressable>
          <FlatList
            data={history}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ paddingHorizontal: 16 }}
            renderItem={({ item }) => {
              const selected = item.id === conversation?.id;
              return (
                <Pressable
                  onPress={() => void switchTo(item)}
                  accessibilityRole="button"
                  style={[styles.historyItem, selected && styles.historyItemActive]}
                >
                  <Text numberOfLines={2} style={styles.historyTitle}>
                    {item.title}
                  </Text>
                  <Text style={styles.historyMeta}>
                    Grade {item.grade} Maths · {item.updated_at.slice(0, 10)}
                  </Text>
                </Pressable>
              );
            }}
          />
          <Text style={styles.historyFoot}>Each question is answered separately; earlier messages are not included.</Text>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: P.bg },

  /* Header */
  header: {
    height: 60,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: P.line,
    backgroundColor: P.bg,
  },
  headerSide: { width: 96, flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  title: { fontFamily: SERIF, fontSize: 18, fontWeight: "700", color: P.ink, letterSpacing: 0.2 },
  gradePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  gradePillText: { fontSize: 11, color: P.gold, fontWeight: "600", letterSpacing: 0.6 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },

  /* Grade picker */
  grades: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: P.line,
    backgroundColor: P.bg,
  },
  grade: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.line,
    backgroundColor: P.card,
  },
  gradeSelected: { backgroundColor: P.forest, borderColor: P.forest },
  gradeText: { fontSize: 12, fontWeight: "600", color: P.body },
  gradeTextSelected: { color: "#F3E2AE" },
  studentModeBanner: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 10, padding: 11, borderRadius: 14, backgroundColor: P.sage, borderWidth: 1, borderColor: P.gold },
  studentModeTitle: { color: P.ink, fontWeight: "800", fontSize: 13 },
  studentModeSubtitle: { color: P.muted, fontSize: 11, marginTop: 2 },

  /* Notices */
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: P.goldSoft,
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17, color: P.body },
  error: {
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#F8E9E5",
    color: P.danger,
    fontSize: 13,
    lineHeight: 19,
    overflow: "hidden",
  },

  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: P.muted, fontSize: 13 },

  /* Intent badge & Next step */
  intentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: P.sage,
    marginLeft: 6,
  },
  intentBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: P.forest,
    letterSpacing: 0.3,
  },
  nextStepCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: P.goldSoft,
    borderLeftWidth: 3,
    borderLeftColor: P.gold,
  },
  nextStepText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: P.body,
    fontWeight: "500",
  },
  rescheduleCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: P.line,
    backgroundColor: P.card,
    gap: 12,
  },
  rescheduleHeader: { gap: 4 },
  rescheduleTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rescheduleTitle: { fontSize: 15, fontWeight: "700", color: P.ink },
  rescheduleMeta: { fontSize: 12, color: P.muted },
  rescheduleSection: { gap: 5 },
  rescheduleLabel: { fontSize: 12, fontWeight: "700", color: P.forest, letterSpacing: 0.3 },
  rescheduleBody: { fontSize: 12.5, lineHeight: 18, color: P.body },
  rescheduleItem: { fontSize: 12.5, lineHeight: 18, color: P.body, paddingLeft: 6 },
  rescheduleError: { fontSize: 12, color: P.danger, lineHeight: 17 },

  /* Messages */
  chatContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    flexGrow: 1,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  userRow: { alignItems: "flex-end", marginVertical: 10 },
  userBubble: {
    maxWidth: "86%",
    backgroundColor: P.forest,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderBottomRightRadius: 6,
  },
  userText: { color: "#FBF8EE", fontSize: 15.5, lineHeight: 23 },
  failed: { marginTop: 10, gap: 6, maxWidth: "88%", alignItems: "flex-end" },
  retry: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6 },
  retryText: { color: P.forest, fontSize: 13, fontWeight: "600" },

  assistantRow: { marginTop: 14, marginBottom: 22, minWidth: 0 },
  assistantHead: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 10 },
  assistantName: { fontFamily: SERIF, fontSize: 14, fontWeight: "700", color: P.ink, letterSpacing: 0.2 },
  assistantBody: { paddingLeft: 33, minWidth: 0 },

  typing: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16, paddingLeft: 33 },
  typingText: { color: P.muted, fontSize: 13 },

  /* Sources */
  sourcesToggle: {
    alignSelf: "flex-start",
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.line,
    backgroundColor: P.card,
  },
  sourcesToggleText: { fontSize: 12, fontWeight: "600", color: P.body },
  source: { marginTop: 10, borderLeftWidth: 2, borderColor: P.gold, paddingLeft: 12, gap: 6 },
  sourceText: { fontSize: 13, lineHeight: 20, color: P.muted },

  /* Empty state */
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 28 },
  emptyRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: P.goldSoft,
    marginBottom: 20,
  },
  emptyTitle: {
    fontFamily: SERIF,
    fontSize: 26,
    lineHeight: 33,
    fontWeight: "700",
    color: P.ink,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  emptySub: { marginTop: 8, fontSize: 14, color: P.muted, textAlign: "center" },
  promptList: { width: "100%", gap: 10, marginTop: 32 },
  prompt: {
    minHeight: 56,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: P.line,
    backgroundColor: P.card,
  },
  promptText: { flex: 1, fontSize: 14, lineHeight: 20, color: P.body },

  waiting: { paddingHorizontal: 20, paddingTop: 6 },

  /* Composer */
  composerArea: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, backgroundColor: P.bg },
  composerBox: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingVertical: 7,
    paddingLeft: 16,
    paddingRight: 7,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: P.line,
    backgroundColor: P.card,
    shadowColor: "#1C2B23",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 130,
    paddingTop: Platform.OS === "ios" ? 10 : 8,
    paddingBottom: Platform.OS === "ios" ? 10 : 8,
    fontSize: 15.5,
    lineHeight: 22,
    color: P.ink,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: P.forest,
  },
  sendDisabled: { backgroundColor: P.disabled },

  /* History */
  historyHeader: {
    height: 60,
    paddingLeft: 22,
    paddingRight: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  historyHeading: { fontFamily: SERIF, fontSize: 22, fontWeight: "700", color: P.ink },
  historyNew: {
    marginHorizontal: 16,
    marginBottom: 8,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: P.sage,
  },
  historyNewIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: P.forest,
    alignItems: "center",
    justifyContent: "center",
  },
  historyNewText: { fontSize: 15, fontWeight: "600", color: P.ink },
  historyItem: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 5,
  },
  historyItemActive: { backgroundColor: P.goldSoft },
  historyTitle: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: P.ink },
  historyMeta: { fontSize: 12, color: P.muted },
  historyFoot: { padding: 20, fontSize: 12, lineHeight: 17, color: P.muted, textAlign: "center" },
});

const emptyStyles = StyleSheet.create({
  artwork: {
    width: "100%",
    maxWidth: 340,
    height: 175,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },

  halo: {
    position: "absolute",
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: "#E5EBDD",
  },

  haloInner: {
    position: "absolute",
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: "#D2E1CC",
  },

  books: {
    position: "absolute",
    width: 100,
    height: 94,
    alignItems: "center",
    justifyContent: "center",
  },

  book: {
    position: "absolute",
    width: 91,
    height: 26,
    borderRadius: 6,
    borderBottomWidth: 4,
    borderBottomColor: "rgba(32,58,46,0.13)",
    justifyContent: "center",
    paddingHorizontal: 8,
  },

  bookBack: {
    top: 11,
    backgroundColor: "#DCD3F0",
    transform: [{ rotate: "9deg" }, { translateX: 2 }],
  },

  bookMiddle: {
    top: 34,
    backgroundColor: "#F4D778",
    transform: [{ rotate: "-3deg" }],
  },

  bookFront: {
    top: 56,
    backgroundColor: "#F0A18C",
    transform: [{ rotate: "4deg" }],
  },

  bookStripe: {
    position: "absolute",
    left: 13,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: "rgba(255,255,255,0.65)",
  },

  bookPages: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.8)",
    borderRadius: 2,
    marginLeft: 10,
    marginRight: 4,
  },

  floatingItem: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#33483A",
    shadowOpacity: 0.16,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },

  sparkle: {
    position: "absolute",
    top: 7,
    left: "25%",
  },

  star: {
    position: "absolute",
    top: 38,
    right: "25%",
  },

  titleRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    marginTop: 5,
  },

  emptyTitle: {
    color: EMPTY_COLORS.forest,
    fontSize: 21,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: -0.5,
  },

  cursor: {
    width: 2,
    height: 23,
    backgroundColor: EMPTY_COLORS.forest,
    marginLeft: 3,
  },

  subtitle: {
    color: EMPTY_COLORS.muted,
    fontSize: 13,
    textAlign: "center",
    marginTop: 9,
    lineHeight: 20,
  },
});

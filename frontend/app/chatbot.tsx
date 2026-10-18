import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router,useLocalSearchParams,useFocusEffect } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import { AppText } from "@/components/AppText";
import { Button } from '@/components/Button';
import { AssistantMessage } from "@/components/AssistantMessage";
import { ScheduleCard } from "@/components/ScheduleCard";
import { colors } from "@/theme";
import { Conversation, ChatMessage, RagChunk } from "@/types/chat";
import type { GeneralSchedule } from "@/types/generalSchedule";
import { listConversations,createConversation,selectConversation,restoreConversation,conversationMessages,sendMessage,retryMessage } from "@/services/chatService";
import { apiBaseUrl } from "@/services/ragClient";
import { useGrade } from "@/hooks/useGrade";
import { chatErrorSummary } from "@/services/chatPresentation";


const gradePrompts={
  1:["Explain counting using classroom objects","Generate five addition questions within 20","Suggest an activity for comparing numbers"],
  2:["Explain tens and ones using bundled sticks","Generate five subtraction practice questions","Suggest a place-value activity"],
  3:["Explain multiplication using equal groups","Generate five practice questions on multiplication","How can I teach division through equal sharing?"],
  5:["Explain decimals using a place-value chart","Compare fractions with different denominators","Suggest an activity for measuring area"],
  4:["Explain equivalent fractions using paper strips","Generate five practice questions on fractions","Suggest an activity for perimeter and measurement"]
};
function IconAction({name,label,onPress,disabled=false}:{name:keyof typeof Ionicons.glyphMap;label:string;onPress:()=>void;disabled?:boolean}) {
  const [tip,setTip]=useState(false);
  return <View><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled}
    onPress={onPress} onHoverIn={() => setTip(true)} onHoverOut={() => setTip(false)} onLongPress={() => setTip(true)} onPressOut={() => setTip(false)}
    style={({pressed}) => [styles.iconButton,{opacity:disabled ? 0.4 : pressed ? 0.6 : 1}]}>
    <Ionicons name={name} size={22} color={colors.forest} />
  </Pressable>{tip ? <View style={styles.tooltip}><Text style={{color:colors.white,fontSize:12}}>{label}</Text></View> : null}</View>;
}
function Sources({json}:{json:string}) {
  const [expanded,setExpanded]=useState(false);
  let sources:RagChunk[]=[]; try {sources=JSON.parse(json);} catch {return null;}
  if (!sources.length) return null;
  const names=[...new Set(sources.map(s => s.source_pdf))];
  return <View style={{marginTop:10,gap:8}}>
    <Pressable accessibilityRole="button" accessibilityLabel="View retrieved sources" onPress={() => setExpanded(!expanded)} style={{minHeight:48,justifyContent:"center"}}>
      <AppText variant="small" style={{color:colors.forest}}><Ionicons name="document-text-outline" size={13} /> {names.length} retrieved source{names.length===1 ? "" : "s"} {expanded ? "-" : "+"}</AppText>
    </Pressable>
    {expanded ? sources.map((source,index) => <View key={`${source.chunk_id}-${index}`} style={styles.source}>
      <AppText variant="small">{source.source_pdf} | Grade {source.grade}{source.source_pages?` | Pages ${source.source_pages}`:''}{source.resource_kind==='source_summary'?' | Source summary':source.resource_kind==='textbook_excerpt'?' | Textbook excerpt':''}</AppText>
      {source.source_url?.startsWith('https://ncert.nic.in/textbook/pdf/')?<Button label="Open NCERT source" variant="quiet" onPress={()=>void Linking.openURL(source.source_url!).catch(()=>{})}/>:null}
      {source.used_fallback ? <AppText variant="small" muted>Retrieved outside the selected grade filter.</AppText> : null}
      <Text selectable style={styles.sourceText}>{source.text}</Text>
    </View>) : null}
  </View>;
}
export default function ChatbotScreen({embedded=false}:{embedded?:boolean}={}) {
  const params=useLocalSearchParams<{grade?:string;prompt?:string;studentId?:string;conceptId?:string;screenContext?:string}>();
  const {grade,setGrade,error:gradeError}=useGrade(Number(params.grade));
  const prompts=gradePrompts[grade];
  const contextualDraft=useRef("");
  const [conversation,setConversation]=useState<Conversation | null>(null); const [history,setHistory]=useState<Conversation[]>([]);
  const [messages,setMessages]=useState<ChatMessage[]>([]); const [draft,setDraft]=useState("");
  const [historyOpen,setHistoryOpen]=useState(false); const [gradeOpen,setGradeOpen]=useState(false);
  const [busy,setBusy]=useState(false); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const [offline,setOffline]=useState(false); const [pendingConversation,setPendingConversation]=useState<string | null>(null);
  const [legacyOpen,setLegacyOpen]=useState<Record<string,boolean>>({});
  const list=useRef<FlatList<ChatMessage>>(null); const composer=useRef<TextInput>(null);
  const active=useRef<string | null>(null); const operation=useRef(false); const drafts=useRef<Record<string,string>>({});
  const scroll=useRef(true); const mounted=useRef(true);
  let configured=false; try {configured=!!apiBaseUrl();} catch { /* Invalid config is reported by the send service. */ }
  const scrollToEnd=useCallback(() => { if(scroll.current) list.current?.scrollToEnd({animated:true}); },[]);
  const refresh=useCallback(async (id:string) => {
    const [rows,conversations]=await Promise.all([conversationMessages(id),listConversations()]);
    if (!mounted.current) return;
    setHistory(conversations); if(active.current===id) {setMessages(rows);setConversation(conversations.find(c => c.id===id) ?? null);}
  },[]);
  useFocusEffect(useCallback(()=>{if(active.current)void refresh(active.current).catch(()=>setError("Could not reload saved conversation."));},[refresh]));
  useEffect(() => {
    mounted.current=true;
    restoreConversation().then(async c => {
      if(!mounted.current) return;
      active.current=c.id; setConversation(c); await refresh(c.id);
    }).catch(e => {if(mounted.current)setError(e instanceof Error ? e.message : "Could not open saved chat.");})
      .finally(() => {if(mounted.current)setLoading(false);});
    const unsubscribe=NetInfo.addEventListener(state => {setOffline(state.isConnected===false);});
    const keyboard=Keyboard.addListener("keyboardDidShow",scrollToEnd);
    return () => {mounted.current=false;unsubscribe();keyboard.remove();};
  },[refresh,scrollToEnd]);
  useEffect(()=>{if(!loading&&params.prompt&&contextualDraft.current!==params.prompt){contextualDraft.current=params.prompt;setDraft(params.prompt);if(active.current)drafts.current[active.current]=params.prompt;composer.current?.focus();}},[loading,params.prompt]);
  async function switchTo(c:Conversation) {
    setHistoryOpen(false);setGradeOpen(false);setError("");scroll.current=true;setLoading(true);
    active.current=c.id;setConversation(c);setGrade(c.grade);setDraft(drafts.current[c.id] ?? "");setMessages([]);
    try {await selectConversation(c.id);await refresh(c.id);}
    catch(e) {setError(e instanceof Error ? e.message : "Could not load chat.");}
    finally {setLoading(false);}
  }
  async function newChat() {
    try {await switchTo(await createConversation(grade));}
    catch(e) {setError(e instanceof Error ? e.message : "Could not create chat.");}
  }
  function changeDraft(value:string) {setDraft(value);if(active.current)drafts.current[active.current]=value;}
  async function submit(retryId?:string) {
    if (operation.current || !conversation || (!retryId && !draft.trim())) return;
    const id=conversation.id; const text=draft; const selectedGrade=grade;
    operation.current=true;setBusy(true);setPendingConversation(id);setError("");scroll.current=true;
    const saved=async () => {
      if(!retryId) {drafts.current[id]="";if(active.current===id)setDraft("");}
      await refresh(id);
    };
    const context = (params.studentId || params.conceptId || params.screenContext) ? {
      student_id: params.studentId,
      concept_id: params.conceptId,
      screen_context: params.screenContext,
    } : undefined;
    try {if(retryId)await retryMessage(retryId,saved);else await sendMessage(id,text,selectedGrade,saved,undefined,context);}
    catch(e) {if(mounted.current)setError(e instanceof Error ? e.message : "Chat could not be saved.");}
    finally {
      operation.current=false;
      if(mounted.current) {
        setBusy(false);setPendingConversation(null);
        try {await refresh(active.current ?? id);} catch {setError("Unable to reload saved messages.");}
      }
    }
  }
  function renderMessage({item}:{item:ChatMessage}) {
    if(item.role==="teacher") return <View style={styles.userRow}><View style={styles.userBubble}>
      <Text selectable style={styles.userText}>{item.text}</Text>
    </View>{item.status==="failed" ? <View style={{marginTop:10,gap:4,maxWidth:"88%"}}>
        <AppText variant="small" muted>{chatErrorSummary(item.error)}</AppText>
        <View style={{flexDirection:"row",flexWrap:"wrap",gap:16}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry failed question" disabled={busy||messages.some(m => m.status==="pending")} onPress={() => void submit(item.id)} style={styles.retry}>
          <Ionicons name="refresh-outline" size={16} color={colors.forest} /><AppText variant="small" style={{color:colors.forest}}>Retry</AppText>
        </Pressable>
        <Button label="Check connection" accessibilityLabel="Check AI connection" icon="link-outline" variant="secondary" onPress={()=>router.push('/connection')}/>
        </View>
      </View> : null}</View>;
    if(item.conversation_id?.startsWith("legacy-") && item.text.startsWith("The local RAG pipeline exists as Python"))return <View style={styles.assistantRow}>
      <Pressable accessibilityRole="button" onPress={()=>setLegacyOpen(old=>({...old,[item.id]:!old[item.id]}))}><AppText variant="small" muted>Earlier service notice (not an AI answer) {legacyOpen[item.id] ? "-" : "+"}</AppText></Pressable>
      {legacyOpen[item.id] ? <Text selectable style={styles.sourceText}>{item.text}</Text> : null}
    </View>;
    let scheduleDraft: GeneralSchedule | null = null;
    if (item.request_json) {
      try {
        const meta = JSON.parse(item.request_json);
        if (meta?.schedule && meta.schedule.kind === "general-schedule") {
          scheduleDraft = meta.schedule as GeneralSchedule;
        }
      } catch { /* Ignore non-schedule metadata */ }
    }
    return <View style={styles.assistantRow}><AppText variant="small" muted style={{marginBottom:8}}>Calcmate</AppText>
      <AssistantMessage text={item.text} onResize={scrollToEnd} />
      {scheduleDraft ? <ScheduleCard draft={scheduleDraft} savedId={scheduleDraft.id} /> : null}
      <Sources json={item.sources_json} />
    </View>;
  }
  const pending=messages.some(m => m.status==="pending");
  return <SafeAreaView style={styles.safe} edges={embedded?["top","left","right"]:["top","bottom","left","right"]}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS==="ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
      <View style={styles.header}>
        {!embedded ? <IconAction name="chevron-back" label="Back" onPress={() => router.back()} /> : null}
        <View style={styles.headerTitle}><AppText variant="subheading">Assistant</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Select teaching grade" onPress={() => setGradeOpen(!gradeOpen)}>
            <AppText variant="small" muted>Grade {grade} Maths <Ionicons name="chevron-down" size={12} /></AppText>
          </Pressable>
        </View>
        <IconAction name="time-outline" label="Conversation history" onPress={() => {Keyboard.dismiss();setHistoryOpen(true);}} />
        <IconAction name="create-outline" label="New chat" onPress={() => void newChat()} disabled={loading} />
      </View>
      {gradeOpen ? <View style={styles.grades}>{[1,2,3,4,5].map(g => <Pressable key={g} accessibilityRole="radio" accessibilityState={{selected:grade===g}}
        onPress={() => {setGrade(g);setGradeOpen(false);}} style={[styles.grade,grade===g && {borderColor:colors.forest}]}>
        <AppText>Grade {g}</AppText>
      </Pressable>)}</View> : null}
      {offline || !configured ? <View style={styles.notice}><Ionicons name="cloud-offline-outline" size={15} color={colors.charcoalMuted} />
        <AppText variant="small" muted style={{flex:1}}>{offline ? "Offline. Saved chats remain available." : "Connect your school server for AI answers."}</AppText>
        <Button label="Connect" accessibilityLabel="Set up AI connection" variant="secondary" onPress={()=>router.push('/connection')}/>
      </View> : null}
      {error||gradeError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error||gradeError}</Text> : null}
      {loading ? <View style={styles.loading}><ActivityIndicator color={colors.forest} /><AppText muted>Opening conversation...</AppText></View> :
        <FlatList ref={list} style={styles.flex} data={messages} keyExtractor={item => item.id} renderItem={renderMessage}
          initialNumToRender={6} maxToRenderPerBatch={4} windowSize={5} removeClippedSubviews={false}
          contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          onContentSizeChange={scrollToEnd} onScroll={event => {const {contentOffset,contentSize,layoutMeasurement}=event.nativeEvent;scroll.current=contentSize.height-contentOffset.y-layoutMeasurement.height<100;}} scrollEventThrottle={80}
          ListEmptyComponent={<View style={styles.empty}>
            <Ionicons name="chatbubble-outline" size={24} color={colors.forest} /><AppText variant="heading">What are we teaching today?</AppText>
            <AppText muted>Maths ideas for your classroom.</AppText>
            <View style={{gap:2,width:"100%",marginTop:20}}>{prompts.map(prompt => <Pressable key={prompt} accessibilityRole="button" onPress={() => {changeDraft(prompt);composer.current?.focus();}} style={styles.prompt}>
              <AppText style={{flex:1}}>{prompt}</AppText><Ionicons name="arrow-up-outline" size={18} color={colors.forest} />
            </Pressable>)}</View>
          </View>}
          ListFooterComponent={pending ? <View accessibilityLiveRegion="polite" style={styles.typing}><ActivityIndicator size="small" color={colors.forest} /><AppText muted>Calcmate is thinking...</AppText></View> : null} />}
      {pendingConversation && pendingConversation!==conversation?.id ? <AppText variant="small" muted style={styles.waiting}>Another conversation is waiting for a response.</AppText> : null}
      <View style={styles.composerArea}><View style={styles.composerBox}>
        <TextInput ref={composer} testID="chat-composer" accessibilityLabel="Teacher question" multiline value={draft} onChangeText={changeDraft}
          placeholder="Ask about teaching Maths..." placeholderTextColor={colors.charcoalMuted} maxLength={2000}
          style={styles.input} textAlignVertical="top" editable={!loading} />
        <Pressable testID="chat-send" accessibilityRole="button" accessibilityLabel="Send question" accessibilityState={{disabled:busy||pending||!draft.trim()||loading}}
          disabled={busy||pending||!draft.trim()||loading} onPress={() => void submit()} style={[styles.send,(busy||pending||!draft.trim()||loading)&&styles.disabled]}>
          {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="arrow-up" size={22} color={colors.white} />}
        </Pressable>
      </View></View>
    </KeyboardAvoidingView>
    <Modal visible={historyOpen} animationType="fade" onRequestClose={() => setHistoryOpen(false)}>
      <SafeAreaView style={styles.safe}><View style={styles.header}><AppText variant="heading" style={{flex:1}}>Conversations</AppText><IconAction name="close" label="Close history" onPress={() => setHistoryOpen(false)} /></View>
        <Pressable style={styles.historyNew} onPress={() => void newChat()} accessibilityRole="button"><Ionicons name="add" size={20} color={colors.forest} /><AppText>New chat</AppText></Pressable>
        <FlatList data={history} keyExtractor={c => c.id} renderItem={({item}) => <Pressable onPress={() => void switchTo(item)} accessibilityRole="button" style={[styles.historyItem,item.id===conversation?.id&&{backgroundColor:colors.sageLight}]}>
          <Text numberOfLines={2} style={styles.historyTitle}>{item.title}</Text><AppText variant="small" muted>Grade {item.grade} Maths | {item.updated_at.slice(0,10)}</AppText>
        </Pressable>} />
        <AppText variant="small" muted style={{padding:20}}>Each question is answered separately; earlier messages are not included.</AppText>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  flex:{flex:1},safe:{flex:1,backgroundColor:colors.ivory},
  header:{minHeight:68,paddingVertical:8,paddingHorizontal:12,flexDirection:"row",alignItems:"center",gap:6,borderBottomWidth:1,borderColor:colors.line},
  headerTitle:{flex:1,minWidth:0,gap:3},iconButton:{width:48,height:48,alignItems:"center",justifyContent:"center"},
  tooltip:{position:"absolute",top:42,right:0,backgroundColor:colors.charcoal,padding:6,zIndex:20,minWidth:95,borderRadius:4},
  grades:{flexDirection:"row",justifyContent:"space-evenly",padding:12,gap:8},grade:{paddingVertical:10,paddingHorizontal:8,borderBottomWidth:2,borderColor:colors.line},
  notice:{flexDirection:"row",alignItems:"center",gap:8,paddingHorizontal:20,paddingVertical:10,backgroundColor:colors.sageLight},
  error:{color:colors.danger,paddingHorizontal:20,paddingVertical:8,fontSize:13,lineHeight:19},
  loading:{flex:1,alignItems:"center",justifyContent:"center",gap:12},chatContent:{padding:16,paddingBottom:24,flexGrow:1,width:"100%",maxWidth:840,alignSelf:"center"},
  empty:{flex:1,alignItems:"center",justifyContent:"center",gap:12,paddingVertical:28},
  prompt:{minHeight:58,paddingVertical:14,flexDirection:"row",alignItems:"center",gap:12,borderBottomWidth:1,borderColor:colors.line},
  userRow:{alignItems:"flex-end",marginVertical:12},userBubble:{maxWidth:"88%",backgroundColor:colors.sageLight,padding:14,borderRadius:8},
  userText:{color:colors.charcoal,fontSize:16,lineHeight:25},assistantRow:{marginTop:12,marginBottom:20,minWidth:0},
  typing:{flexDirection:"row",alignItems:"center",gap:10,paddingVertical:18},
  retry:{minHeight:48,flexDirection:"row",alignItems:"center",gap:6},source:{borderLeftWidth:2,borderColor:colors.sage,paddingLeft:10,gap:6},
  sourceText:{fontSize:13,lineHeight:20,color:colors.charcoalMuted},
  composerArea:{paddingHorizontal:16,paddingTop:10,paddingBottom:12,backgroundColor:colors.ivory,borderTopWidth:1,borderColor:colors.line},
  composerBox:{flexDirection:"row",alignItems:"flex-end",gap:10,borderWidth:1,borderColor:colors.sage,borderRadius:8,padding:8,backgroundColor:colors.paper},
  input:{flex:1,minHeight:42,maxHeight:140,paddingHorizontal:6,paddingVertical:10,fontSize:16,lineHeight:23,color:colors.charcoal},
  send:{width:48,height:48,borderRadius:6,alignItems:"center",justifyContent:"center",backgroundColor:colors.forest},
  disabled:{opacity:0.4},waiting:{paddingHorizontal:20,paddingTop:6},historyNew:{minHeight:56,flexDirection:"row",alignItems:"center",gap:10,paddingHorizontal:20},
  historyItem:{paddingHorizontal:20,paddingVertical:16,borderBottomWidth:1,borderColor:colors.line,gap:6},
  historyTitle:{fontSize:16,lineHeight:23,fontWeight:"600",color:colors.charcoal}
});

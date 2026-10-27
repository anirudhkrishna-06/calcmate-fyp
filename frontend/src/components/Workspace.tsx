import { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText } from "./AppText";
import { colors } from "@/theme";

export function Section({ title, detail, action, children }: { title:string; detail?:string; action?:ReactNode; children:ReactNode }) {
  return <View style={styles.section}>
    <View style={styles.header}><View style={{flex:1,minWidth:0}}><AppText variant="subheading">{title}</AppText>{detail ? <AppText variant="small" muted>{detail}</AppText> : null}</View>{action}</View>
    {children}
  </View>;
}
export function EmptyState({ title, detail, children }: {title:string;detail:string;children?:ReactNode}) {
  return <View style={{gap:8,paddingVertical:20}}><AppText variant="subheading">{title}</AppText><AppText muted>{detail}</AppText>{children}</View>;
}
export function LocalStatus({text="Saved on device"}:{text?:string}) {
  return <AppText variant="small" muted>{text}</AppText>;
}
export function ActionRow({title,detail,onPress}:{title:string;detail?:string;onPress:()=>void}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({pressed})=>[styles.row,pressed&&{backgroundColor:colors.sageLight}]}>
    <View style={{flex:1,minWidth:0,gap:2}}><AppText style={{color:colors.primary,fontWeight:'600'}}>{title}</AppText>{detail ? <AppText variant="small" muted>{detail}</AppText> : null}</View><AppText style={{color:colors.primary}}>→</AppText>
  </Pressable>;
}
const styles=StyleSheet.create({
  section:{gap:12,paddingTop:16,borderTopWidth:1,borderColor:colors.line},
  header:{flexDirection:"row",alignItems:"center",gap:8},
  row:{minHeight:52,paddingVertical:12,paddingHorizontal:12,flexDirection:"row",alignItems:"center",gap:12,borderWidth:1,borderRadius:6,borderColor:colors.primary,backgroundColor:colors.surface}
});

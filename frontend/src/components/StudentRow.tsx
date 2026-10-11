import { Pressable,View } from "react-native";
import { Link } from "expo-router";
import { AppText } from "./AppText";
import { Student } from "@/types/domain";
import { colors } from "@/theme";
export function StudentRow({student}:{student:Student}){
  const status=student.hasEvidence===false?"Not assessed":(student.needsRevision||student.mastery<0.6)?"Needs revision":student.mastery>=0.8?"Secure":"Practicing";
  return <Link href={`/students/${student.id}`} asChild><Pressable accessibilityRole="button" accessibilityLabel={`${student.name}, roll ${student.rollNumber}, ${status}`} style={({pressed})=>({minHeight:68,paddingVertical:12,flexDirection:"row",gap:12,alignItems:"center",borderBottomWidth:1,borderColor:colors.line,backgroundColor:pressed?colors.sageLight:"transparent"})}>
    <View style={{width:36,alignItems:'center',gap:2}}><AppText variant="small" muted>Roll</AppText><AppText style={{fontWeight:'700'}}>{student.rollNumber}</AppText></View>
    <View style={{flex:1,minWidth:0,gap:4}}><AppText style={{fontWeight:'700',fontSize:16}}>{student.name}</AppText>{student.currentUnit?<AppText variant="small" muted>{student.currentUnit}</AppText>:null}<AppText variant="small" style={{color:status==='Needs revision'?colors.attention:status==='Not assessed'?colors.textMuted:colors.primary}}>{status}{student.hasEvidence!==false?` · ${Math.round(student.mastery*100)}%`:''}</AppText></View>
    <View style={{minHeight:48,justifyContent:'center',borderWidth:1,borderColor:colors.primary,borderRadius:4,paddingHorizontal:10,paddingVertical:8}}><AppText variant="small" style={{color:colors.primary,fontWeight:'700'}}>Open →</AppText></View>
  </Pressable></Link>;
}

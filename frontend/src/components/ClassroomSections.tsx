import { Pressable,View,StyleSheet } from 'react-native';
import { AppText } from './AppText';
import { colors } from '@/theme';
export const classroomSections=[{value:'students',label:'Students'},{value:'attendance',label:'Attendance'},{value:'assessments',label:'Assessments'},{value:'progress',label:'Progress'}];
export function ClassroomSections({selected,disabled,onSelect}:{selected:string;disabled?:boolean;onSelect:(value:string)=>void}){
  return <View accessibilityRole="tablist" style={styles.tabList}>
    {classroomSections.map(item=>{
      const active=selected===item.value;
      return <Pressable key={item.value} accessibilityRole="tab" accessibilityState={{selected:active,disabled}} disabled={disabled} onPress={()=>onSelect(item.value)} style={({pressed})=>[styles.tab,active&&styles.activeTab,pressed&&styles.pressedTab,disabled&&styles.disabled]}>
        <AppText style={{color:active?colors.white:colors.text,fontWeight:active?'700':'500',textAlign:'center'}}>{item.label}</AppText>
      </Pressable>;
    })}
  </View>;
}
const styles=StyleSheet.create({
  tabList:{flexDirection:'row',flexWrap:'wrap',gap:6,padding:5,borderWidth:1,borderColor:colors.border,borderRadius:14,backgroundColor:colors.surface},
  tab:{flexBasis:'46%',flexGrow:1,minHeight:46,paddingHorizontal:12,paddingVertical:10,justifyContent:'center',alignItems:'center',borderRadius:10},
  activeTab:{backgroundColor:colors.primary},
  pressedTab:{backgroundColor:colors.primarySurface},
  disabled:{opacity:0.5}
});

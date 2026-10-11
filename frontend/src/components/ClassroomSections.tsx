import { Pressable,View } from 'react-native';
import { AppText } from './AppText';
import { colors } from '@/theme';
export const classroomSections=[{value:'students',label:'Students'},{value:'attendance',label:'Attendance'},{value:'assessments',label:'Assessments'},{value:'progress',label:'Progress'}];
export function ClassroomSections({selected,disabled,onSelect}:{selected:string;disabled?:boolean;onSelect:(value:string)=>void}){
  return <View accessibilityRole="tablist" style={{flexDirection:'row',flexWrap:'wrap',gap:6,padding:6,borderWidth:1,borderColor:colors.border,borderRadius:8,backgroundColor:colors.surface}}>
    {classroomSections.map(item=>{
      const active=selected===item.value;
      return <Pressable key={item.value} accessibilityRole="tab" accessibilityState={{selected:active,disabled}} disabled={disabled} onPress={()=>onSelect(item.value)} style={({pressed})=>({flexBasis:'46%',flexGrow:1,minHeight:48,paddingHorizontal:12,paddingVertical:10,justifyContent:'center',alignItems:'center',borderRadius:4,backgroundColor:active?colors.primary:pressed?colors.primarySurface:'transparent',opacity:disabled?0.5:1})}>
        <AppText style={{color:active?colors.white:colors.text,fontWeight:active?'700':'500',textAlign:'center'}}>{item.label}</AppText>
      </Pressable>;
    })}
  </View>;
}

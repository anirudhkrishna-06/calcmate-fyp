import { useState } from "react";
import { Keyboard,Modal,Pressable,View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { colors } from "@/theme";

export function DateField({label,value,onChange,maxDate,disabled=false}:{label:string;value:string;onChange:(date:string)=>void;maxDate?:string;disabled?:boolean}){
  const [open,setOpen]=useState(false);
  const [month,setMonth]=useState(()=>new Date(`${value}T12:00:00`));
  const year=month.getFullYear(),index=month.getMonth();
  const offset=new Date(year,index,1).getDay();
  const count=new Date(year,index+1,0).getDate();
  const cells=Array.from({length:Math.ceil((offset+count)/7)*7},(_,i)=>i-offset+1);
  return <View style={{gap:6}}><AppText variant="small" muted>{label}</AppText>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={()=>{Keyboard.dismiss();setMonth(new Date(`${value}T12:00:00`));setOpen(true);}} style={{minHeight:48,padding:12,borderWidth:1,borderColor:colors.line,borderRadius:6,backgroundColor:colors.paper,opacity:disabled?0.5:1}}>
      <AppText>{new Date(`${value}T12:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}  ▾</AppText>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
      <SafeAreaView style={{flex:1,justifyContent:"center",padding:16,backgroundColor:"rgba(25,30,25,0.3)"}}>
        <View style={{backgroundColor:colors.ivory,padding:16,borderRadius:8,width:"100%",maxWidth:420,alignSelf:"center",gap:12}}>
          <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}>
            <Button label="‹" accessibilityLabel="Previous month" variant="quiet" onPress={()=>setMonth(new Date(year,index-1,1))}/><AppText variant="subheading">{month.toLocaleDateString("en-IN",{month:"long",year:"numeric"})}</AppText><Button label="›" accessibilityLabel="Next month" variant="quiet" onPress={()=>setMonth(new Date(year,index+1,1))}/>
          </View>
          <View style={{flexDirection:"row"}}>{["Su","Mo","Tu","We","Th","Fr","Sa"].map(day=><View key={day} style={{width:"14.2857%",alignItems:"center"}}><AppText variant="small" muted>{day}</AppText></View>)}</View>
          <View style={{flexDirection:"row",flexWrap:"wrap"}}>{cells.map((day,i)=>{
            const date=`${year}-${String(index+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const valid=day>0&&day<=count;const unavailable=!valid||!!(maxDate&&date>maxDate);
            return <Pressable key={i} accessibilityRole="button" accessibilityLabel={valid?date:"Blank calendar cell"} accessibilityState={{disabled:unavailable,selected:date===value}} disabled={unavailable} onPress={()=>{onChange(date);setOpen(false);}} style={{width:"14.2857%",minHeight:48,justifyContent:"center",alignItems:"center",backgroundColor:date===value?colors.sageLight:"transparent",opacity:unavailable?0.35:1}}><AppText>{valid?day:""}</AppText></Pressable>;
          })}</View>
          <Button label="Close calendar" variant="quiet" onPress={()=>setOpen(false)}/>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}

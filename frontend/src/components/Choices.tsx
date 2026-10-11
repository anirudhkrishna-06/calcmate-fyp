import { Pressable, View } from "react-native";
import { AppText } from "./AppText";
import { colors } from "@/theme";
export function Choices({ values, selected, onSelect, multiple=false }: { values: { value:string; label:string; disabled?:boolean }[]; selected:string[]; onSelect:(value:string)=>void; multiple?:boolean }) {
  return <View style={{ flexDirection:"row", flexWrap:"wrap", gap:8, marginVertical:8 }}>
    {values.map(item => <Pressable key={item.value} disabled={item.disabled} accessibilityRole={multiple?'checkbox':'radio'} accessibilityState={{ selected:selected.includes(item.value), checked:multiple?selected.includes(item.value):undefined, disabled:item.disabled }}
      onPress={() => onSelect(item.value)} style={{ maxWidth:"100%", minHeight:48, padding:10, borderBottomWidth:2, borderColor:selected.includes(item.value) ? colors.forest : colors.line, opacity:item.disabled ? 0.4 : 1 }}>
      <AppText style={{ color:selected.includes(item.value) ? colors.forest : colors.charcoal }}>{item.label}</AppText>
    </Pressable>)}
  </View>;
}

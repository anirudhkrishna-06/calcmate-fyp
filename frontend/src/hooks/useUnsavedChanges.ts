import { Alert } from "react-native";
import { useNavigation,usePreventRemove } from "expo-router/react-navigation";
export function useUnsavedChanges(dirty:boolean){
  const navigation=useNavigation();
  usePreventRemove(dirty,({data})=>{
    Alert.alert("Leave without saving?","Your changes have not been saved to classroom records.",[
      {text:"Keep editing",style:"cancel"},
      {text:"Leave",style:"destructive",onPress:()=>navigation.dispatch(data.action)}
    ]);
  });
}

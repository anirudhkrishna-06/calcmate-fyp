import { memo, useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { assistantDocument } from "@/services/assistantMarkdown";
import { colors } from "@/theme";
export const AssistantMessage=memo(function AssistantMessage({text,onResize}:{text:string;onResize?:()=>void}) {
  const html=useMemo(() => assistantDocument(text),[text]); const [height,setHeight]=useState(80); const [failed,setFailed]=useState(false);
  return <View style={{width:"100%",minWidth:0}}>
    {failed ? <Text selectable style={{fontSize:16,lineHeight:26,color:colors.charcoal}}>{text}</Text> :
      <WebView originWhitelist={["*"]} source={{html}} scrollEnabled={false} style={{flex:0,height,width:"100%",backgroundColor:"transparent"}}
        setSupportMultipleWindows={false} allowFileAccess={false} mixedContentMode="never" textZoom={100}
        onError={() => setFailed(true)}
        onShouldStartLoadWithRequest={request => {
          if (request.url==="about:blank") return true;
          if (request.isTopFrame && /^https?:\/\//i.test(request.url)) void Linking.openURL(request.url).catch(() => {});
          return false;
        }}
        onMessage={event => {
          try { const value=JSON.parse(event.nativeEvent.data).height; if(Number.isFinite(value)&&value>=0&&value<100000) {setHeight(Math.max(24,value+4));onResize?.();} } catch { /* Ignore non-layout WebView messages. */ }
        }} />}
  </View>;
});

import { Link,useFocusEffect } from 'expo-router';
import { useCallback,useRef,useState } from 'react';
import { AppState,View } from 'react-native';
import { Screen } from '@/components/Screen';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { FormStatus } from '@/components/FormStatus';
import { pendingAccount,checkApproval } from '@/services/authService';
export default function Pending(){
  const [email,setEmail]=useState<string|null>(null);const [status,setStatus]=useState('pending');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const refresh=useRef<()=>Promise<void>>(async()=>{});
  useFocusEffect(useCallback(()=>{
    let active=true,running=false,terminal=false;
    const check=async()=>{if(!active||running||terminal||AppState.currentState==='background')return;running=true;setBusy(true);try{const email=await pendingAccount();const next=await checkApproval();if(active){setEmail(email);setStatus(next);setError('');terminal=next!=='pending';}}catch(e){if(active)setError(e instanceof Error?e.message:'Server unavailable. We will retry.');}finally{running=false;if(active)setBusy(false);}};
    refresh.current=check;void check();const timer=setInterval(()=>void check(),10000);
    const foreground=AppState.addEventListener('change',state=>{if(state==='active')void check();});
    return()=>{active=false;clearInterval(timer);foreground.remove();};
  },[]));
  return <Screen><View style={{gap:16,paddingVertical:16}}><AppText variant="title">{status==='approved'?'Account approved':status==='rejected'?'Request not approved':'Account submitted'}</AppText>
    <AppText variant="heading">{status==='approved'?'You can now log in':status==='rejected'?'Contact your administrator':'Awaiting administrator approval'}</AppText>
    {email?<AppText muted>{email}</AppText>:null}
    <AppText muted>{status==='pending'?'Your administrator sees your request in the approval inbox. This screen checks automatically.':status==='manual'?'Log in to check your request. Automatic tracking is unavailable for this signup.':status==='rejected'?'Your account remains locked. Ask your administrator to review access.':'Use your email and password to open your classroom.'}</AppText>
    <FormStatus message={error} error/>
    {status==='pending'?<Button label={busy?'Checking...':'Check now'} variant="secondary" disabled={busy} onPress={()=>void refresh.current()}/>:null}
    {status!=='rejected'?<Link href="/login" asChild><Button label={status==='approved'?'Log in':'Check approval / Log in'} icon="log-in-outline"/></Link>:null}
    <Link href="/welcome" asChild><Button label="Back to welcome" variant="secondary"/></Link>
  </View></Screen>;
}

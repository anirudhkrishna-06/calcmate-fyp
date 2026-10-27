import { Directory,File, Paths } from "expo-file-system";
import { exportWorkspace } from "./storageService";
import { serializeBackup,validateBackupJson } from "./backupFormat";
import { requireSession } from "./authService";
import { withTransaction } from "./database";
export type BackupResult = { status:"saved"; path:string; createdAt:string } | { status:"cancelled" };
export async function createLocalBackup():Promise<BackupResult> {
  let destination:Directory;
  try { destination=await Directory.pickDirectoryAsync(); }
  catch(error) {
    const code=(error as {code?:string})?.code;
    if (code === "ERR_PICKER_CANCELLED" || code === "ERR_FILE_PICKING_CANCELLED") return {status:"cancelled"};
    throw new Error("Unable to select a backup folder. Check file access permissions.");
  }
  if ([Paths.document.uri,Paths.cache.uri].some(uri => destination.uri.replace(/\/$/,"") === uri.replace(/\/$/,"") || destination.uri.startsWith(uri.replace(/\/$/,"")+"/"))) {
    throw new Error("Choose a folder outside Calcmate's private storage.");
  }
  const snapshot=await exportWorkspace();
  const json=serializeBackup(snapshot);
  let file:ReturnType<Directory["createFile"]> | undefined;
  try {
    file=destination.createFile(`calcmate-backup-${Date.now()}.json`,"application/json");
    file.write(json);
    const written=await file.text();
    validateBackupJson(written);
    if (written !== json) throw new Error("Backup verification failed.");
    const session=await requireSession();
    await withTransaction(async tx=>{await tx.runAsync("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",`backup.last:${session.workspaceId}`,snapshot.createdAt as string);});
    return {status:"saved",path:file.uri,createdAt:snapshot.createdAt as string};
  } catch {
    try { file?.delete(); } catch { /* Preserve the original write/verification error. */ }
    throw new Error("Backup could not be written or verified. Choose a writable folder with enough free space.");
  }
}
export async function lastBackup() {
  const session=await requireSession();
  return withTransaction(async tx=>(await tx.getFirstAsync<{value:string}>("SELECT value FROM app_meta WHERE key=?",`backup.last:${session.workspaceId}`))?.value ?? null);
}
export async function selectBackup() {
  const result=await File.pickFileAsync({mimeTypes:["application/json"]});
  if(result.canceled)return null;
  if(result.result.size>10*1024*1024)throw new Error("Backup exceeds the 10 MB limit.");
  const json=await result.result.text();const data=validateBackupJson(json);
  const session=await requireSession();
  if(data.workspace.id!==session.workspaceId||data.workspace.mode!==session.mode)throw new Error("Select a backup from this workspace.");
  return {json,students:data.students.length,exportedAt:data.exportedAt as string};
}

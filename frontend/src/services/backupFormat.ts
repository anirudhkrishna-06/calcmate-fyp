const credentialKeys = new Set(["password", "passwordhash", "rawpassword", "hashedpassword", "token", "accesstoken", "refreshtoken", "idtoken", "secret", "clientsecret", "secretkey", "privatekey", "apikey", "authorization", "credentials", "session"]);
function withoutCredentials(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(withoutCredentials);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !credentialKeys.has(key.toLowerCase().replace(/[_-]/g,"")))
    .map(([key,item]) => [key,withoutCredentials(item)]));
  return value;
}
export function serializeBackup(snapshot:Record<string,unknown>):string {
  const records = (key:string) => {
    const data=snapshot[key];
    if (!Array.isArray(data)) throw new Error(`Backup is missing ${key} records.`);
  return data;
  };
  const optionalRecords = (key:string) => Array.isArray(snapshot[key]) ? snapshot[key] : [];
  const decode = (key:string) => records(key).map(row => ({...row,data:JSON.parse(row.data)}));
  const backup = withoutCredentials({
    format:"calcmate-workspace",version:4,exportedAt:snapshot.createdAt,
    workspace:{ id:snapshot.workspaceId,mode:snapshot.mode },
    teacherProfiles:decode("profiles"),students:records("students"),attendance:records("attendance"),
    assessments:records("assessments"),assessmentMetadata:records("assessment_metadata"),mathsConcepts:records("concepts"),competencies:records("competencies"),
    observations:records("observations"),schedules:decode("schedules"),chatHistory:records("messages"),
    conversations:records("conversations"),chatMessageDetails:records("message_details"),
    concept_prerequisites:records("concept_prerequisites"),class_sessions:records("class_sessions"),session_attendance_events:records("session_attendance_events"),session_outcomes:records("session_outcomes"),assessment_origins:records("assessment_origins"),notifications:optionalRecords("notifications")
  });
  const json=JSON.stringify(backup,null,2);
  validateBackupJson(json);
  return json;
}
export function validateBackupJson(json:string) {
  const data=JSON.parse(json);
  if (data.format !== "calcmate-workspace" || ![1,2,3,4].includes(data.version) || !data.workspace?.id) throw new Error("Invalid Calcmate backup header.");
  for (const key of ["teacherProfiles","students","attendance","assessments","mathsConcepts","competencies","observations","schedules","chatHistory"]) {
    if (!Array.isArray(data[key])) throw new Error(`Invalid backup ${key}.`);
  }
  if (data.version>=2 && (!Array.isArray(data.conversations) || !Array.isArray(data.chatMessageDetails))) throw new Error("Invalid backup conversations.");
  if(data.version>=3)for(const key of ["concept_prerequisites","class_sessions","session_attendance_events","session_outcomes","assessment_origins"])if(!Array.isArray(data[key]))throw new Error(`Invalid backup ${key}.`);
  if(data.version>=4&&!Array.isArray(data.assessmentMetadata))throw new Error("Invalid backup assessment metadata.");
  if(data.notifications!==undefined&&!Array.isArray(data.notifications))throw new Error("Invalid backup notifications.");
  return data;
}

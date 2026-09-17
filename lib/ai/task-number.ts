import { createHash, randomUUID } from "node:crypto";

function businessTimestamp(date:Date){
  const chinaTime=new Date(date.getTime()+8*60*60*1000);
  return chinaTime.toISOString().replace(/[-:T]/g,"").slice(0,14);
}

export function createScreeningTaskNumber(_purpose:string,date=new Date()){
  const unique=randomUUID().replaceAll("-","").slice(0,16).toUpperCase();
  return `AI-SX-${unique}-${businessTimestamp(date)}`;
}

export function acquisitionTaskNumberPrefix(userId:string,requestKey:string,costMode:string){
  const identity=createHash("sha256").update(`${userId}:${requestKey}:${costMode}`).digest("hex").slice(0,16).toUpperCase();
  return `AI-HK-${identity}`;
}

export function createAcquisitionTaskNumber(userId:string,requestKey:string,costMode:string,date=new Date()){
  return `${acquisitionTaskNumberPrefix(userId,requestKey,costMode)}-${businessTimestamp(date)}`;
}

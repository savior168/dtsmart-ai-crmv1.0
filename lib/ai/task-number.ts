const PURPOSE_CODE:Record<string,string>={
  SMART:"SMART",
  DEEP:"DEEP",
  QUICK:"QUICK",
  RECHECK:"RECHECK",
  REVIEW:"REVIEW",
};

function businessTimestamp(date:Date){
  const chinaTime=new Date(date.getTime()+8*60*60*1000);
  return chinaTime.toISOString().replace(/[-:T]/g,"").slice(0,14);
}

export function createScreeningTaskNumber(purpose:string,date=new Date()){
  const code=PURPOSE_CODE[purpose]||"SMART";
  return `SCR-${code}-${businessTimestamp(date)}-${crypto.randomUUID().replaceAll("-","").slice(0,6).toUpperCase()}`;
}

export function createAcquisitionTaskNumber(userId:string,requestKey:string,costMode:string){
  const mode=costMode==="FREE_ONLY"?"FREE":"ADAPT";
  const owner=userId.replaceAll("-","").slice(0,6).toUpperCase();
  const request=requestKey.replaceAll("-","").slice(0,16).toUpperCase();
  return `ACQ-${mode}-${owner}-${request}`;
}

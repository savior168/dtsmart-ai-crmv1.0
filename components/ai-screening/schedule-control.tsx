"use client";

import { CalendarClock } from "lucide-react";
import { input } from "@/components/ai-screening/ui";

type ScheduleType = "now" | "scheduled";

function localDateTime(date: Date) {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

function nextScheduleTime() {
  const next = new Date(Date.now() + 30 * 60_000);
  next.setMinutes(Math.ceil(next.getMinutes() / 30) * 30, 0, 0);
  return localDateTime(next);
}

const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  const minute = index % 2 ? "30" : "00";
  return `${hour}:${minute}`;
});

export function ScheduleControl({
  scheduleType,
  scheduledAt,
  onScheduleTypeChange,
  onScheduledAtChange,
}: {
  scheduleType: ScheduleType;
  scheduledAt: string;
  onScheduleTypeChange: (value: ScheduleType) => void;
  onScheduledAtChange: (value: string) => void;
}) {
  const [date = "", time = ""] = scheduledAt.split("T");
  const today = localDateTime(new Date()).slice(0, 10);
  const selectScheduled = () => {
    onScheduleTypeChange("scheduled");
    if (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now()) onScheduledAtChange(nextScheduleTime());
  };
  const updateDate = (nextDate: string) => onScheduledAtChange(nextDate ? `${nextDate}T${time || nextScheduleTime().slice(11)}` : "");
  const updateTime = (nextTime: string) => onScheduledAtChange(`${date || nextScheduleTime().slice(0, 10)}T${nextTime}`);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex h-[38px] rounded-[7px] border border-[#dfe5ee] bg-[#f7f9fc] p-[3px]" role="group" aria-label="执行方式">
        <button
          type="button"
          onClick={() => { onScheduleTypeChange("now"); onScheduledAtChange(""); }}
          className={`rounded-[5px] px-3 text-sm font-medium transition ${scheduleType === "now" ? "bg-white text-[#1763e8] shadow-sm" : "text-[#657187] hover:text-[#334158]"}`}
        >
          立即执行
        </button>
        <button
          type="button"
          onClick={selectScheduled}
          className={`flex items-center gap-1.5 rounded-[5px] px-3 text-sm font-medium transition ${scheduleType === "scheduled" ? "bg-white text-[#1763e8] shadow-sm" : "text-[#657187] hover:text-[#334158]"}`}
        >
          <CalendarClock size={15} />预约执行
        </button>
      </div>
      {scheduleType === "scheduled" ? (
        <div className="flex min-w-[300px] flex-1 items-center gap-2">
          <label className="relative min-w-[170px] flex-1">
            <CalendarClock className="pointer-events-none absolute left-3 top-[11px] text-slate-400" size={16} />
            <input
              type="date"
              aria-label="预约执行日期"
              className={`${input} w-full pl-10`}
              value={date}
              min={today}
              onChange={(event) => updateDate(event.target.value)}
            />
          </label>
          <select
            aria-label="预约执行时间"
            className={`${input} w-[112px] shrink-0`}
            value={time}
            onChange={(event) => updateTime(event.target.value)}
          >
            {timeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      ) : <span className="text-sm text-[#778397]">任务创建后立即进入队列执行</span>}
    </div>
  );
}

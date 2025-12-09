"use client";

"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type WhenNeedItProps = {
  selectedTime: string;
  onSelect: (timeValue: string) => void;
};

const OPTIONS = [
  "Right now",
  "Within 2 hours",
  "Today",
  "Tomorrow",
  "Schedule later",
];

export default function WhenNeedIt({ selectedTime, onSelect }: WhenNeedItProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [scheduledValue, setScheduledValue] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const handleSelect = (value: string) => {
    if (value === "Schedule later") {
      setShowPicker(true);
      onSelect(value);
      return;
    }
    setShowPicker(false);
    onSelect(value);
  };

  const handleScheduleChange = (value: string) => {
    setScheduledValue(value);
    if (value) {
      onSelect(value);
      setShowPicker(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const chipClass = useMemo(
    () =>
      (active: boolean) =>
        `rounded-full px-4 py-2 text-sm font-semibold transition border whitespace-nowrap ${
          active
            ? "bg-[#1B5E20] text-white border-[#1B5E20] shadow-sm"
            : "border-[#1B5E20] text-[#1B5E20] bg-white hover:bg-[#1B5E20]/10"
        }`,
    []
  );

  return (
    <div className="w-full">
      <p className="text-sm font-semibold text-[#111827] mb-2">When do you need it?</p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => {
          const active = selectedTime === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => handleSelect(option)}
              className={chipClass(active)}
            >
              {option}
            </button>
          );
        })}
      </div>

      {showPicker && (
        <div className="relative mt-3" ref={pickerRef}>
          <div className="absolute z-30 w-64 rounded-xl border border-emerald-100 bg-white p-3 shadow-lg">
            <label className="text-xs font-semibold text-slate-700">Pick a date & time</label>
            <input
              type="datetime-local"
              value={scheduledValue}
              onChange={(e) => handleScheduleChange(e.target.value)}
              className="mt-2 w-full rounded-lg border border-emerald-200 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
        </div>
      )}
    </div>
  );
}

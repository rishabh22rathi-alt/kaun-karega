"use client";

import { useMemo } from "react";

type WhenNeedItProps = {
  selectedTime: string;
  serviceDate: string;
  timeSlot: string;
  minDate?: string;
  dateError?: string;
  showQuestionLabel?: boolean;
  onSelect: (timeValue: string) => void;
  onServiceDateChange: (date: string) => void;
  onTimeSlotChange: (slot: string) => void;
};

const OPTIONS = [
  "Right now",
  "Within 2 hours",
  "Today",
  "Tomorrow",
  "Schedule later",
];

const TIME_SLOTS = ["Morning", "Noon", "Afternoon", "Evening"] as const;

const SLOT_LABELS: Record<(typeof TIME_SLOTS)[number], string> = {
  Morning: "Morning (8-11)",
  Noon: "Noon (11-2)",
  Afternoon: "Afternoon (2-5)",
  Evening: "Evening (5-8)",
};

export default function WhenNeedIt({
  selectedTime,
  serviceDate,
  timeSlot,
  minDate = "",
  dateError = "",
  showQuestionLabel = true,
  onSelect,
  onServiceDateChange,
  onTimeSlotChange,
}: WhenNeedItProps) {
  const handleSelect = (value: string) => {
    onSelect(value);
    if (value !== "Schedule later") {
      onServiceDateChange("");
      onTimeSlotChange("");
    }
  };

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
      {showQuestionLabel ? (
        <p className="mb-2 text-sm font-semibold text-[#111827]">
          When do you need it?
        </p>
      ) : null}
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

      {selectedTime === "Schedule later" && (
        <div className="mt-3 rounded-xl border border-emerald-100 bg-white p-3 shadow-sm">
          <label className="text-xs font-semibold text-slate-700">
            Select date
          </label>
          <input
            type="date"
            value={serviceDate}
            min={minDate}
            onChange={(e) => onServiceDateChange(e.target.value)}
            className="mt-2 w-full rounded-lg border border-emerald-200 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          {dateError ? (
            <p className="mt-2 text-xs font-medium text-red-600">{dateError}</p>
          ) : null}

          <p className="mt-3 text-xs font-semibold text-slate-700">
            Select time slot
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TIME_SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => onTimeSlotChange(slot)}
                className={chipClass(timeSlot === slot)}
              >
                {SLOT_LABELS[slot]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import Chip from "./Chip";

type ChipGroupProps = {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
};

export default function ChipGroup({
  title,
  options,
  selected,
  onToggle,
}: ChipGroupProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={selected.includes(option)}
            onClick={() => onToggle(option)}
          />
        ))}
      </div>
    </div>
  );
}

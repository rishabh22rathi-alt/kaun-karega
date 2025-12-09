type ChipProps = {
  label: string;
  selected?: boolean;
  onClick?: () => void;
};

export default function Chip({ label, selected, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition shadow-sm border ${
        selected
          ? "bg-[#0EA5E9] text-white border-[#0EA5E9] shadow-md"
          : "bg-white text-slate-700 border-[#0EA5E9]/40 hover:bg-orange-100 hover:border-orange-400"
      }`}
    >
      {label}
    </button>
  );
}

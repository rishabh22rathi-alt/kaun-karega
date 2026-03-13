import { X } from "lucide-react";

type ChipProps = {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
};

const BASE_CLASS =
  "inline-flex items-center gap-2 px-4 py-2 rounded-full border border-green-700 text-green-800 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-green-700/30 disabled:cursor-not-allowed disabled:opacity-60";
const SELECTED_CLASS = "bg-green-700 text-white border-green-700";
const UNSELECTED_HOVER_CLASS = "hover:bg-green-50";
const SELECTED_HOVER_CLASS = "hover:bg-green-800";

export default function Chip({
  label,
  selected = false,
  onClick,
  onRemove,
  disabled = false,
  className = "",
}: ChipProps) {
  const clickable = Boolean(onClick);
  const chipClass = `${BASE_CLASS} ${selected ? `${SELECTED_CLASS} ${SELECTED_HOVER_CLASS}` : UNSELECTED_HOVER_CLASS} ${className}`.trim();

  if (!clickable) {
    return (
      <span
        className={chipClass}
        aria-disabled={disabled || undefined}
      >
        <span className="truncate">{label}</span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full transition ${
              selected
                ? "text-white hover:text-white/80"
                : "text-green-800 hover:text-green-900"
            }`}
            aria-label={`Remove ${label}`}
          >
            <X size={12} strokeWidth={2.4} />
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={chipClass}
    >
      <span className="truncate">{label}</span>
      {onRemove ? (
        <span
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full transition ${
            selected
              ? "text-white hover:text-white/80"
              : "text-green-800 hover:text-green-900"
          }`}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onRemove();
            }
          }}
          aria-label={`Remove ${label}`}
        >
          <X size={12} strokeWidth={2.4} />
        </span>
      ) : null}
    </button>
  );
}

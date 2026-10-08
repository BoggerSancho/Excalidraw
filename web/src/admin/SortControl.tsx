export type SortKey = "name" | "updated";
export type SortState = { key: SortKey; dir: "asc" | "desc" };

export const DEFAULT_DIR: Record<SortKey, SortState["dir"]> = { name: "asc", updated: "desc" };

const LABELS: Record<SortKey, string> = { name: "Name", updated: "Last updated" };

export function SortControl({ value, onChange }: { value: SortState; onChange: (next: SortState) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Sort workspaces">
      {(["name", "updated"] as const).map((key) => {
        const active = value.key === key;
        const arrow = value.dir === "asc" ? "↑" : "↓";
        return (
          <button
            key={key}
            type="button"
            className={active ? "active" : ""}
            aria-pressed={active}
            title={active ? "Click to reverse the order" : `Sort by ${LABELS[key].toLowerCase()}`}
            onClick={() =>
              onChange(
                active
                  ? { key, dir: value.dir === "asc" ? "desc" : "asc" }
                  : { key, dir: DEFAULT_DIR[key] },
              )
            }
          >
            {LABELS[key]} {active && <span aria-hidden>{arrow}</span>}
          </button>
        );
      })}
    </div>
  );
}

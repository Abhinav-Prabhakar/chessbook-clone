import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { lichessAnalysis } from "../chess";

interface Props {
  sans: string[];
  /** Index of the highlighted ply (the last one shown on the board). */
  current?: number;
  onSelect?: (plyIndex: number) => void;
  /** A placeholder for the move being asked, e.g. "＿". */
  pending?: string | null;
  startPly?: number;
}

export function MoveList({ sans, current = sans.length - 1, onSelect, pending = null, startPly = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector(".ml-current, .ml-pending");
    el?.scrollIntoView({ block: "nearest", inline: "end" });
  }, [current, sans.length, pending]);
  const items: ReactNode[] = [];
  const total = sans.length + (pending ? 1 : 0);
  for (let i = 0; i < total; i += 1) {
    const ply = startPly + i;
    if (ply % 2 === 0 || i === 0) {
      items.push(
        <span className="ml-num" key={`n${i}`}>
          {Math.floor(ply / 2) + 1}
          {ply % 2 === 0 ? "." : "…"}
        </span>
      );
    }
    if (i < sans.length) {
      const cls = `ml-move${i === current ? " ml-current" : ""}${onSelect ? " ml-click" : ""}`;
      items.push(
        onSelect ? (
          <button type="button" className={cls} key={i} onClick={() => onSelect(i)}>
            {sans[i]}
          </button>
        ) : (
          <span className={cls} key={i}>
            {sans[i]}
          </span>
        )
      );
    } else {
      items.push(
        <span className="ml-pending" key="pending">
          {pending}
        </span>
      );
    }
  }
  return (
    <div className="move-list" ref={ref}>
      {items}
    </div>
  );
}

export function BoardStrip({
  title,
  children,
  fen,
  orientation = "white",
}: {
  title?: ReactNode;
  children?: ReactNode;
  fen?: string;
  orientation?: string;
}) {
  return (
    <div className="board-strip">
      <div className="strip-title">{title}</div>
      <div className="strip-right">
        {children}
        {fen && (
          <a className="strip-link" href={lichessAnalysis(fen, orientation)} target="_blank" rel="noreferrer">
            Analyze <Icon name="external" />
          </a>
        )}
      </div>
    </div>
  );
}

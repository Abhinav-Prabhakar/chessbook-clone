import { useEffect, useLayoutEffect, useRef } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Board } from "../board/Board";
import { useStageContext } from "../board/stage";
import { animationMs, useSettings } from "../settings";
import { Icon } from "../ui/Icon";

/** The section of the app a path belongs to; changing section animates the sidebar. */
function sectionOf(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/";
}

export function AppShell() {
  const { board, onMoveRef, setSlots } = useStageContext();
  const { settings } = useSettings();
  const { pathname } = useLocation();
  const crumbRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setSlots(crumbRef.current, captionRef.current);
  }, [setSlots]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="app">
      <div className="mobile-bar">
        <Link to="/" className="mobile-logo" aria-label="Home">
          <img src="/chessbook-mark.svg" alt="" />
          <span>Chessbook</span>
        </Link>
        <Link to="/settings" className="top-link">
          Settings <Icon name="gear" />
        </Link>
      </div>
      <div className="layout">
        <section className={`board-col${board.peek ? " peek" : ""}`}>
          <div className="board-col-inner">
            <div className="crumb-slot" ref={crumbRef} />
            <div className="board-frame">
              <Board
                fen={board.fen}
                orientation={board.orientation}
                lastMove={board.lastMove}
                interactive={board.interactive}
                arrows={board.arrows}
                marks={board.marks}
                onMove={(move) => onMoveRef.current?.(move)}
                theme={settings.boardTheme}
                pieceSet={settings.pieceSet}
                coordinates={settings.coordinates}
                showLegal={settings.legalMoves}
                animationMs={animationMs(settings.animation)}
              />
            </div>
            <div className="caption-slot" ref={captionRef} />
          </div>
        </section>
        <aside className="sidebar">
          <div className="sidebar-top">
            <Link to="/settings" className={`top-link${pathname === "/settings" ? " active" : ""}`}>
              Settings <Icon name="gear" />
            </Link>
          </div>
          <div className="page" key={sectionOf(pathname)}>
            <Outlet />
          </div>
        </aside>
      </div>
    </div>
  );
}

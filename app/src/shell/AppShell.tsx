import { Component, createRef, useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigationType } from "react-router-dom";
import type { Location } from "react-router-dom";
import { Board } from "../board/Board";
import { CrumbList, useStageContext } from "../board/stage";
import { animationMs, useSettings } from "../settings";
import { Icon } from "../ui/Icon";

type Direction = "forward" | "back";

/** Which sidebar "view" a location is. Each builder position is its own view. */
function viewKey(location: Location) {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (path.endsWith("/build")) return `${path}?${new URLSearchParams(location.search).get("path") ?? ""}`;
  return path;
}

/** How deep a location is: deeper means "forward", shallower means "back". */
function depthOf(location: Location) {
  const segments = location.pathname.split("/").filter(Boolean).length;
  const path = new URLSearchParams(location.search).get("path");
  const plies = path ? path.split(",").filter(Boolean).length : 0;
  return segments * 1000 + plies;
}

const OUT_MS = 160;
const IN_MS = 160;

/**
 * Sidebar view transitions, as in the production app: the old view fades out
 * while sliding 20px, then the new view fades in from 20px on the other side.
 * Going deeper enters from the right; going back enters from the left.
 *
 * The outgoing view is a snapshot of its DOM taken right before React swaps
 * the content, so the old page does not have to stay mounted.
 */
class SidebarViews extends Component<{ viewKey: string; direction: Direction; enabled: boolean; children: ReactNode }> {
  private view = createRef<HTMLDivElement>();
  private exit = createRef<HTMLDivElement>();
  private timers: number[] = [];

  getSnapshotBeforeUpdate(prev: { viewKey: string }) {
    if (!this.props.enabled || prev.viewKey === this.props.viewKey || !this.view.current) return null;
    return this.view.current.cloneNode(true) as HTMLElement;
  }

  componentDidUpdate(_prev: unknown, _state: unknown, snapshot: HTMLElement | null) {
    if (snapshot) this.animate(snapshot);
  }

  componentWillUnmount() {
    this.timers.forEach((t) => window.clearTimeout(t));
  }

  private animate(snapshot: HTMLElement) {
    const exit = this.exit.current;
    const view = this.view.current;
    if (!exit || !view) return;
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    const forward = this.props.direction === "forward";

    snapshot.removeAttribute("style");
    snapshot.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    exit.replaceChildren(snapshot);
    snapshot.style.transition = "none";
    snapshot.style.opacity = "1";
    snapshot.style.transform = "translateX(0)";

    view.style.transition = "none";
    view.style.opacity = "0";
    view.style.transform = `translateX(${forward ? 20 : -20}px)`;
    // Reading layout commits the starting styles, so the transitions below
    // run without waiting for an animation frame.
    void view.offsetHeight;
    void snapshot.offsetHeight;

    snapshot.style.transition = `opacity ${OUT_MS}ms ease-out, transform ${OUT_MS}ms ease-out`;
    snapshot.style.opacity = "0";
    snapshot.style.transform = `translateX(${forward ? -20 : 20}px)`;
    view.style.transition = `opacity ${IN_MS}ms ease-out ${OUT_MS}ms, transform ${IN_MS}ms ease-out ${OUT_MS}ms`;
    view.style.opacity = "1";
    view.style.transform = "translateX(0)";
    this.timers.push(
      window.setTimeout(() => exit.replaceChildren(), OUT_MS + 40),
      window.setTimeout(() => {
        view.style.transition = "";
        view.style.transform = "";
        view.style.opacity = "";
      }, OUT_MS + IN_MS + 40)
    );
  }

  render() {
    return (
      <div className="views">
        <div className="view-exit" ref={this.exit} aria-hidden />
        <div className="view" ref={this.view}>
          {this.props.children}
        </div>
      </div>
    );
  }
}

export function AppShell() {
  const { board, onMoveRef, setSlots, crumbs } = useStageContext();
  const { settings } = useSettings();
  const location = useLocation();
  const navigationType = useNavigationType();
  const captionRef = useRef<HTMLDivElement>(null);
  const previous = useRef(location);
  const direction = useRef<Direction>("forward");

  // Work out the direction during render, before the views update.
  if (previous.current.key !== location.key) {
    const before = depthOf(previous.current);
    const after = depthOf(location);
    direction.current = after > before ? "forward" : after < before ? "back" : navigationType === "POP" ? "back" : "forward";
    previous.current = location;
  }

  useLayoutEffect(() => {
    setSlots(null, captionRef.current);
  }, [setSlots]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

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
            <div className="crumb-slot">{crumbs.length > 0 && <CrumbList items={crumbs} />}</div>
            <div className="board-frame">
              <Board
                fen={board.fen}
                orientation={board.orientation}
                lastMove={board.lastMove}
                interactive={board.interactive}
                arrows={board.arrows}
                marks={board.marks}
                feedback={board.feedback}
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
            <Link to="/settings" className={`top-link${location.pathname.startsWith("/settings") ? " active" : ""}`}>
              Settings <Icon name="gear" />
            </Link>
          </div>
          <SidebarViews viewKey={viewKey(location)} direction={direction.current} enabled={settings.animation !== "off"}>
            <Outlet />
          </SidebarViews>
        </aside>
      </div>
    </div>
  );
}

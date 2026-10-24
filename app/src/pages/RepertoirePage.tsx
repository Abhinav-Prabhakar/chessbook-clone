import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Crumbs, START_FEN, useBoard } from "../board/stage";
import { forget, forgetAll, useApi } from "../useApi";
import type { Daily, Gap, RepertoireSummary } from "../types";
import { Back, Button, ErrorNote, Icon, Modal, PageHead, Progress, Row, Section, Skeleton, relativeDue, useToast } from "../ui";
import { buildPath, learnPath } from "../routes";
import { gapText } from "./Dashboard";

export function RepertoirePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useApi<{ repertoire: RepertoireSummary; daily: Daily }>(`/repertoires/${id}`);
  const gaps = useApi<{ gaps: Gap[]; total: number; completion: number; coverageGoal: number }>(`/repertoires/${id}/gaps?limit=6`);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | "import" | "rename" | "delete">(null);
  const rep = data?.repertoire;
  useBoard({ fen: START_FEN, orientation: rep?.color ?? "white", peek: true });

  if (error && !data) return <ErrorNote error={error} retry={reload} />;
  if (!rep) return <Skeleton rows={6} />;

  const refresh = () => {
    forget(`/repertoires/${id}`);
    forget("/dashboard");
    void reload();
    void gaps.reload();
  };

  const runAutofill = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ added: unknown[]; completion: number }>(`/repertoires/${id}/autofill`, { limit: 15 });
      toast(result.added.length ? `Added ${result.added.length} moves · now ${result.completion}% complete` : "No gaps left to fill at your coverage goal");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const gap = rep.biggestGap;
  return (
    <>
      <Crumbs items={[{ label: rep.name }]} />
      <Back to="/" />
      <PageHead title={rep.name} />

      <div className="stat-block">
        <div className="stat-line">
          <strong>{rep.started ? `${rep.completion}% complete` : "Not started"}</strong>
          {rep.gapCount > 0 && (
            <button type="button" className="head-link" onClick={runAutofill} disabled={busy}>
              {busy ? "Filling gaps…" : "Autofill remaining gaps"} <Icon name="wand" />
            </button>
          )}
        </div>
        <Progress value={rep.completion} />
      </div>
      <Row
        variant="accent"
        className="block-row"
        title={rep.started ? "Continue building" : "Start building"}
        right={<span className="pill">{rep.stats.saved} Saved</span>}
        to={buildPath(rep.id)}
      />

      <div className="stat-block">
        <div className="stat-line">
          <strong>{rep.stats.masteredPercent.toFixed(1)}% mastered</strong>
        </div>
        <Progress value={rep.stats.masteredPercent} tone="orange" />
      </div>
      <Row
        variant="accent"
        className="block-row"
        title="Continue learning"
        meta={rep.due === 0 && rep.nextDue ? `Next review ${relativeDue(rep.nextDue)}` : undefined}
        right={
          rep.due > 0 ? (
            <span className="pill due">
              {rep.due} due <Icon name="clock" />
            </span>
          ) : (
            <span className="pill done">
              Up to date <Icon name="check" />
            </span>
          )
        }
        to={learnPath(rep.id)}
        disabled={rep.stats.mine === 0}
      />

      {gap && (
        <div className="rows list spaced">
          <Row
            title="Go to your biggest gap"
            meta={gapText(gap)}
            right={<span className="setting-value">1 in {gap.expectedIn} games</span>}
            to={buildPath(rep.id, gap.path)}
          />
        </div>
      )}

      {gaps.data && gaps.data.gaps.length > 1 && (
        <Section
          title="Other gaps"
          right={<span className="muted">Lines seen in at least 1 in {gaps.data.coverageGoal} games</span>}
        >
          <div className="rows list">
            {gaps.data.gaps.slice(1, 6).map((g) => (
              <Row
                key={g.path.join(" ")}
                variant="plain"
                title={g.lastMove ? `After ${g.label}` : "Your first move"}
                meta={g.opening?.name}
                right={<span className="muted">1 in {g.expectedIn} games</span>}
                to={buildPath(rep.id, g.path)}
                chevron
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Settings">
        <div className="rows list">
          <Row variant="plain" title="Import moves from PGN" meta="Paste a game, a study or a file with variations" onClick={() => setModal("import")} chevron />
          <Row
            variant="plain"
            title="Export as PGN"
            onClick={() => window.open(`/api/repertoires/${rep.id}/export`, "_blank")}
            right={<Icon name="download" />}
          />
          <Row variant="plain" title="Review history" to={`/history?repertoire=${rep.id}`} chevron />
          <Row variant="plain" title="Rename" onClick={() => setModal("rename")} chevron />
          <Row variant="plain" className="danger" title="Delete repertoire" onClick={() => setModal("delete")} />
        </div>
      </Section>

      {modal === "import" && (
        <ImportModal
          id={rep.id}
          onClose={() => setModal(null)}
          onDone={(added) => {
            toast(`Imported ${added} moves`);
            setModal(null);
            refresh();
          }}
        />
      )}
      {modal === "rename" && (
        <RenameModal
          name={rep.name}
          onClose={() => setModal(null)}
          onSave={async (name) => {
            await api.patch(`/repertoires/${rep.id}`, { name });
            setModal(null);
            refresh();
          }}
        />
      )}
      {modal === "delete" && (
        <Modal title="Delete this repertoire?" onClose={() => setModal(null)}>
          <p className="modal-text">
            {rep.name} and its {rep.stats.saved} saved moves and review history will be removed from this device.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api.del(`/repertoires/${rep.id}`);
                forgetAll();
                navigate("/");
              }}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ImportModal({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: (added: number) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ added: number }>(`/repertoires/${id}/import`, { pgn: text });
      onDone(result.added);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Import from PGN" onClose={onClose}>
      <p className="modal-text">Every line in the PGN is added, including variations. Moves you already have are kept.</p>
      <textarea
        className="textarea"
        rows={8}
        placeholder="1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 cxd4 4. Nxd4"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <label className="file-pick">
        <input
          type="file"
          accept=".pgn,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setText(await file.text());
          }}
        />
        Or choose a .pgn file
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy || !text.trim()}>
          {busy ? "Importing…" : "Import"}
        </Button>
      </div>
    </Modal>
  );
}

function RenameModal({ name, onClose, onSave }: { name: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [value, setValue] = useState(name);
  return (
    <Modal title="Rename repertoire" onClose={onClose}>
      <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} autoFocus />
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onSave(value)} disabled={!value.trim()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

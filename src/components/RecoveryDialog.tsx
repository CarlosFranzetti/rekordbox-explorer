import { useState } from 'react';
import { LifeBuoy, Loader2, Download, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { attemptRecovery, type RecoveryReport, type RecoverySource } from '@/lib/recovery';

/**
 * "Attempt USB recovery" — for the morning after a drive was pulled mid-write.
 *
 * The premise is not repair. A database that lost its unflushed pages cannot be
 * reconstructed, and telling someone otherwise sends them hunting for a tool
 * that cannot exist. What *does* work is that a stick usually carries more than
 * one library, written at different times, and the one that was not open when
 * the drive vanished is generally fine.
 *
 * So this reads every library it can find, shows the health of each, and offers
 * a rekordbox XML built from whichever kept the most. It never writes.
 */

const HEALTH_LABEL: Record<string, string> = {
  ok: 'Complete',
  damaged: 'Damaged',
  truncated: 'Incomplete',
  unwritten: 'Never written',
  unreadable: 'Unreadable',
};

function SourceRow({ source }: { source: RecoverySource }) {
  const good = (source.playlistCount ?? 0) > 0 || (source.trackCount ?? 0) > 0;
  const pct = Math.round(source.assessment.completeness * 100);

  return (
    <div className="rounded border border-border p-3">
      <div className="flex items-start gap-2">
        {good ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
        ) : (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{source.label}</p>
          <p className="font-mono text-xs text-muted-foreground">{source.path}</p>

          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium">
              {HEALTH_LABEL[source.assessment.health] ?? source.assessment.health}
            </span>
            {source.assessment.pagesExpected > 0 && (
              <> · {pct}% present ({source.assessment.pagesPresent}/{source.assessment.pagesExpected} pages)</>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{source.assessment.summary}</p>

          {good && (
            <p className="mt-1 text-xs text-foreground">
              Readable: <strong>{source.trackCount}</strong> tracks,{' '}
              <strong>{source.playlistCount}</strong> playlists
            </p>
          )}
          {source.error && (
            <p className="mt-1 text-xs text-destructive">Could not read: {source.error}</p>
          )}
          {source.sidecarNotes.map((n) => (
            <p key={n} className="mt-1 text-xs text-warning">
              {n}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RecoveryDialog({ root }: { root: FileSystemDirectoryHandle | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!root) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await attemptRecovery(root));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery could not run.');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!report?.xml) return;
    const blob = new Blob([report.xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovered-rekordbox.xml';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 text-xs"
        onClick={() => setOpen(true)}
        title="Recover playlists from a damaged drive"
      >
        <LifeBuoy className="h-4 w-4" />
        <span className="hidden sm:inline">Recovery</span>
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-8 w-full max-w-lg rounded-lg border border-border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <LifeBuoy className="h-4 w-4" />
            Attempt USB recovery
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          For a drive that was unplugged without ejecting. This reads every library on the
          stick — rekordbox, OneLibrary and Engine DJ — and rebuilds your playlists from
          whichever survived. <strong className="text-foreground">Nothing is written to the drive.</strong>
        </p>

        {!root && (
          <p className="mt-3 rounded border border-warning/30 bg-warning/10 p-2 text-xs text-muted-foreground">
            Open a USB drive first. Recovery needs the whole drive, not a single file, because
            the library that survived may not be the one you were using.
          </p>
        )}

        <Button className="mt-3 w-full gap-2" onClick={run} disabled={!root || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LifeBuoy className="h-4 w-4" />}
          {busy ? 'Scanning every library…' : 'Scan this drive'}
        </Button>

        {error && (
          <p className="mt-3 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {report && (
          <div className="mt-4 space-y-3">
            <div
              className={`rounded border p-3 ${
                report.recovered
                  ? 'border-green-500/30 bg-green-500/10'
                  : 'border-warning/30 bg-warning/10'
              }`}
            >
              <p className="text-sm font-medium text-foreground">{report.summary}</p>
            </div>

            {report.xml && (
              <Button className="w-full gap-2" onClick={download}>
                <Download className="h-4 w-4" />
                Download recovered playlists (rekordbox XML)
              </Button>
            )}

            {report.advice.length > 0 && (
              <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
                {report.advice.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ol>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Libraries found
              </p>
              {report.sources.length === 0 && (
                <p className="text-xs text-muted-foreground">No library files found on this drive.</p>
              )}
              {report.sources.map((s) => (
                <SourceRow key={s.path} source={s} />
              ))}
            </div>

            <div className="flex items-start gap-2 rounded border border-border p-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-xs text-muted-foreground">
                If nothing here recovered your playlists, stop using the drive and take a full disk
                image before anything else. Deleted data often still exists in unallocated space,
                and every write risks landing on top of it.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

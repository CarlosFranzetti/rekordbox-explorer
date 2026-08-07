import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, HardDriveDownload, Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { PlaylistTables } from '@/lib/pdb/playlists';
import type { DraftChange } from '@/lib/playlist-draft';
import {
  COMMIT_STEPS,
  COMMIT_STEP_LABEL,
  CommitError,
  commitPlaylists,
  type CommitStep,
  type CommitStepState,
} from '@/lib/usb/commit';

interface CommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: FileSystemDirectoryHandle;
  tables: PlaylistTables;
  changes: DraftChange[];
  trackCount: number;
  backupLimit: number;
  onCommitted: (backupId: string) => void;
}

type StepMap = Partial<Record<CommitStep, { state: CommitStepState; detail?: string }>>;

export function CommitDialog({
  open,
  onOpenChange,
  root,
  tables,
  changes,
  trackCount,
  backupLimit,
  onCommitted,
}: CommitDialogProps) {
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done' | 'failed'>('confirm');
  const [steps, setSteps] = useState<StepMap>({});
  const [error, setError] = useState<{ message: string; rolledBack: boolean } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (open) {
      setPhase('confirm');
      setSteps({});
      setError(null);
      setSummary(null);
    }
  }, [open]);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase('running');
    setSteps({});
    setError(null);

    try {
      const result = await commitPlaylists({
        root,
        tables,
        backupLimit,
        stats: { tracks: trackCount, playlists: tables.nodes.length },
        onProgress: ({ step, state, detail }) =>
          setSteps((prev) => ({ ...prev, [step]: { state, detail } })),
      });

      setSummary(
        `Saved. ${result.pagesAppended} new page${
          result.pagesAppended === 1 ? '' : 's'
        } appended (+${(result.bytesAdded / 1024).toFixed(0)} KB). Backup ${result.backup.id} kept in two places.`
      );
      setPhase('done');
      onCommitted(result.backup.id);
    } catch (caught) {
      const commitError = caught instanceof CommitError ? caught : null;
      setError({
        message: caught instanceof Error ? caught.message : String(caught),
        rolledBack: commitError?.rolledBack ?? false,
      });
      setPhase('failed');
    } finally {
      runningRef.current = false;
    }
  }, [backupLimit, onCommitted, root, tables, trackCount]);

  const busy = phase === 'running';

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDriveDownload className="h-5 w-5" />
            Save playlists to the drive
          </DialogTitle>
          <DialogDescription>
            {phase === 'confirm'
              ? 'Your current library is backed up to two separate folders and verified before anything is written.'
              : 'Do not unplug the drive until this finishes.'}
          </DialogDescription>
        </DialogHeader>

        {phase === 'confirm' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="mb-2 text-sm font-medium">
                {changes.length} change{changes.length === 1 ? '' : 's'} to write
              </p>
              <ScrollArea className="max-h-40">
                <ul className="space-y-1 pr-3 text-sm text-muted-foreground">
                  {changes.map((change, i) => (
                    <li key={`${change.id}-${change.kind}-${i}`} className="flex gap-2">
                      <span
                        className={cn(
                          'shrink-0 font-mono text-xs uppercase',
                          change.kind === 'removed' ? 'text-destructive' : 'text-primary'
                        )}
                      >
                        {change.kind.replace('-', ' ')}
                      </span>
                      <span className="truncate">{change.name}</span>
                      {change.detail && (
                        <span className="ml-auto shrink-0 text-xs">{change.detail}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="text-muted-foreground">
                <p className="font-medium text-foreground">Your audio is never touched.</p>
                <p>
                  Only the playlist tables change. Waveforms, beatgrids and hot cues live in
                  separate analysis files that this app does not write.
                </p>
              </div>
            </div>
          </div>
        )}

        {(phase === 'running' || phase === 'done' || phase === 'failed') && (
          <ol className="space-y-2">
            {COMMIT_STEPS.map((step) => {
              const state = steps[step]?.state ?? 'pending';
              return (
                <li key={step} className="flex items-center gap-3 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    {state === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    {state === 'done' && <Check className="h-4 w-4 text-green-500" />}
                    {state === 'failed' && <X className="h-4 w-4 text-destructive" />}
                    {state === 'pending' && (
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                    )}
                  </span>
                  <span
                    className={cn(
                      state === 'pending' && 'text-muted-foreground',
                      state === 'failed' && 'text-destructive'
                    )}
                  >
                    {COMMIT_STEP_LABEL[step]}
                  </span>
                  {steps[step]?.detail && (
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {steps[step]?.detail}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {phase === 'done' && summary && (
          <p className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-muted-foreground">
            {summary}
          </p>
        )}

        {phase === 'failed' && error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-foreground">{error.message}</p>
              <p className="mt-1 text-muted-foreground">
                {error.rolledBack
                  ? 'Your previous library was restored automatically.'
                  : 'Nothing was left half-written. Your backups are on the drive, and WHATTODOIFTHISWENTTOSHIT.txt at the drive root explains how to restore them.'}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {phase === 'confirm' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={run} className="gap-2">
                <ShieldCheck className="h-4 w-4" />
                Back up and save
              </Button>
            </>
          )}
          {phase === 'running' && (
            <Button disabled className="gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Working…
            </Button>
          )}
          {phase === 'done' && <Button onClick={() => onOpenChange(false)}>Done</Button>}
          {phase === 'failed' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={run}>Try again</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  HardDriveDownload,
  LifeBuoy,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { createZip } from '@/lib/zip';
import { downloadBytes, safeFileName } from '@/lib/usb/fs';
import {
  BACKUP_REASON_LABEL,
  createBackup,
  deleteBackup,
  listBackups,
  readBackupFile,
  restoreBackup,
  verifyBackup,
  type BackupHealth,
  type StoredBackup,
} from '@/lib/usb/backup';
import { RECOVERY_NOTE_FILENAME } from '@/lib/usb/recovery-note';

interface BackupsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: FileSystemDirectoryHandle | null;
  canWrite: boolean;
  backupLimit: number;
  trackCount: number;
  playlistCount: number;
  onRestored: () => void;
}

export function BackupsDialog({
  open,
  onOpenChange,
  root,
  canWrite,
  backupLimit,
  trackCount,
  playlistCount,
  onRestored,
}: BackupsDialogProps) {
  const [health, setHealth] = useState<BackupHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, 'ok' | 'bad'>>({});
  const [confirmRestore, setConfirmRestore] = useState<StoredBackup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StoredBackup | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    if (!root) return;
    setLoading(true);
    try {
      setHealth(await listBackups(root));
    } catch (error) {
      toast({
        title: 'Could not read backups',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [root, toast]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const handleCreate = async () => {
    if (!root) return;
    setBusyId('new');
    try {
      const result = await createBackup(root, {
        reason: 'manual',
        limit: backupLimit,
        stats: { tracks: trackCount, playlists: playlistCount },
      });
      toast({
        title: 'Backup created',
        description: `${result.verifiedVaults.length} verified cop${
          result.verifiedVaults.length === 1 ? 'y' : 'ies'
        } on the drive.`,
      });
      await refresh();
    } catch (error) {
      toast({
        title: 'Backup failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleVerify = async (set: StoredBackup) => {
    if (!root) return;
    setBusyId(set.id);
    try {
      const report = await verifyBackup(root, set);
      setVerified((prev) => ({ ...prev, [set.id]: report.ok ? 'ok' : 'bad' }));
      toast({
        title: report.ok ? 'Backup verified' : 'Backup is damaged',
        description: report.ok
          ? 'Every file matches its checksum.'
          : report.checked
              .filter((c) => !c.ok)
              .map((c) => `${c.vault}/${c.file}: ${c.detail}`)
              .join('; '),
        variant: report.ok ? 'default' : 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (set: StoredBackup) => {
    if (!root) return;
    setBusyId(set.id);
    try {
      const result = await restoreBackup(root, set, { limit: backupLimit });
      toast({
        title: 'Library restored',
        description: `Put back ${result.restored.join(', ')}. Eject the drive properly before using it.`,
      });
      await refresh();
      onRestored();
    } catch (error) {
      toast({
        title: 'Restore failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
      setConfirmRestore(null);
    }
  };

  const handleDelete = async (set: StoredBackup) => {
    if (!root) return;
    setBusyId(set.id);
    try {
      await deleteBackup(root, set.id);
      toast({ title: 'Backup deleted' });
      await refresh();
    } catch (error) {
      toast({
        title: 'Could not delete',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  const handleExport = async (sets: StoredBackup[], label: string) => {
    if (!root) return;
    setBusyId(sets.length === 1 ? sets[0].id : 'export-all');
    try {
      const entries = [];
      for (const set of sets) {
        for (const file of set.files) {
          const bytes = await readBackupFile(root, set.id, file.name);
          if (bytes) entries.push({ path: `${set.id}/${file.name}`, data: new Uint8Array(bytes) });
        }
        entries.push({
          path: `${set.id}/backup.json`,
          data: new TextEncoder().encode(JSON.stringify(set, null, 2)),
        });
      }

      if (entries.length === 0) {
        toast({ title: 'Nothing to export', variant: 'destructive' });
        return;
      }

      entries.push({
        path: 'READ-ME-FIRST.txt',
        data: new TextEncoder().encode(
          `Rekordbox Explorer backup archive\n` +
            `Exported ${new Date().toISOString()}\n\n` +
            `Each folder is one snapshot of a rekordbox device library.\n` +
            `To restore by hand: copy export.pdb (and exportExt.pdb if present)\n` +
            `from a snapshot folder into PIONEER/rekordbox/ on the drive,\n` +
            `then eject the drive properly.\n\n` +
            `See ${RECOVERY_NOTE_FILENAME} at the root of the drive for the full guide.\n`
        ),
      });

      downloadBytes(createZip(entries), `${safeFileName(label, 'backups')}.zip`, 'application/zip');
      toast({ title: 'Archive downloaded', description: `${sets.length} snapshot(s).` });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const sets = health?.sets ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[90dvh] max-h-[90dvh] w-[min(96vw,780px)] max-w-none flex-col overflow-hidden p-4 sm:p-6">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Backups &amp; recovery
            </DialogTitle>
            <DialogDescription>
              Every snapshot is stored twice on the drive — at <code>/RBXPLORER_BACKUPS</code> and
              inside <code>/PIONEER/rekordbox/RBXPLORER_SAFETY</code> — and checksummed.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="backups" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="grid w-full shrink-0 grid-cols-2">
              <TabsTrigger value="backups">Backups ({sets.length})</TabsTrigger>
              <TabsTrigger value="rescue">
                <LifeBuoy className="mr-1.5 h-4 w-4" />
                Rescue
              </TabsTrigger>
            </TabsList>

            <TabsContent value="backups" className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={handleCreate}
                  disabled={!canWrite || !root || busyId !== null}
                >
                  {busyId === 'new' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <HardDriveDownload className="h-4 w-4" />
                  )}
                  Back up now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5"
                  onClick={() => handleExport(sets, 'rekordbox-backups')}
                  disabled={sets.length === 0 || busyId !== null}
                >
                  <Archive className="h-4 w-4" />
                  Export all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-9 w-9 p-0"
                  onClick={refresh}
                  disabled={loading}
                  aria-label="Refresh backup list"
                >
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                </Button>
              </div>

              {!canWrite && (
                <p className="shrink-0 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-muted-foreground">
                  This browser cannot write to drives, so backups are read-only here. Use Chrome,
                  Edge or Opera on a desktop to create or restore them.
                </p>
              )}

              {health?.singleCopyIds.length ? (
                <p className="shrink-0 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-muted-foreground">
                  {health.singleCopyIds.length} snapshot(s) exist in only one location. Still
                  usable, but they have no mirror.
                </p>
              ) : null}

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-2 pr-3">
                  {sets.length === 0 && !loading && (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      No backups on this drive yet.
                    </p>
                  )}

                  {sets.map((set) => (
                    <div key={set.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{set.id}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {BACKUP_REASON_LABEL[set.reason] ?? set.reason}
                        </Badge>
                        {set.vaults.length === 2 ? (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <CheckCircle2 className="h-3 w-3" />2 copies
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1 text-[10px]">
                            <AlertTriangle className="h-3 w-3" />1 copy
                          </Badge>
                        )}
                        {verified[set.id] === 'ok' && (
                          <Badge className="gap-1 bg-green-600 text-[10px] hover:bg-green-600">
                            <CheckCircle2 className="h-3 w-3" />
                            verified
                          </Badge>
                        )}
                        {verified[set.id] === 'bad' && (
                          <Badge variant="destructive" className="text-[10px]">
                            damaged
                          </Badge>
                        )}
                      </div>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(set.createdAt).toLocaleString()} ·{' '}
                        {set.files.map((f) => f.name).join(', ')}
                        {set.stats?.tracks != null && ` · ${set.stats.tracks} tracks`}
                        {set.stats?.playlists != null && `, ${set.stats.playlists} playlists`}
                      </p>
                      {set.label && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{set.label}</p>
                      )}

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9"
                          onClick={() => handleVerify(set)}
                          disabled={busyId !== null}
                        >
                          {busyId === set.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            'Verify'
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 gap-1.5"
                          onClick={() => handleExport([set], set.id)}
                          disabled={busyId !== null}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Export
                        </Button>
                        <Button
                          size="sm"
                          className="h-9"
                          onClick={() => setConfirmRestore(set)}
                          disabled={!canWrite || busyId !== null}
                        >
                          Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-9 w-9 p-0 text-destructive"
                          onClick={() => setConfirmDelete(set)}
                          disabled={!canWrite || busyId !== null}
                          aria-label={`Delete backup ${set.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="rescue" className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <div className="space-y-4 pr-3 text-sm">
                  <div className="rounded-lg border border-border p-3">
                    <h3 className="mb-1 font-medium">Library will not load?</h3>
                    <p className="text-muted-foreground">
                      Restore the newest snapshot from the Backups tab. It verifies every checksum
                      before overwriting anything, and it snapshots the drive's current state first
                      — so restoring is itself undoable.
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <h3 className="mb-1 font-medium">A player says the device library is corrupt</h3>
                    <p className="text-muted-foreground">
                      Say <strong>no</strong> if it offers to delete or rebuild the library — that
                      erases your playlists. Restore a backup instead.
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <h3 className="mb-1 font-medium">No backups on this drive</h3>
                    <p className="text-muted-foreground">
                      Plug it into rekordbox in Export mode and re-export your playlists to the
                      device. Your audio files stay where they are.
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <h3 className="mb-1 font-medium">Offline instructions live on the drive</h3>
                    <p className="text-muted-foreground">
                      Every write refreshes <code>{RECOVERY_NOTE_FILENAME}</code> at the drive root.
                      It is plain text, it lists the backups present, and it walks through restoring
                      by hand with nothing but a file manager.
                    </p>
                  </div>

                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
                    <h3 className="mb-1 font-medium">Always eject properly</h3>
                    <p className="text-muted-foreground">
                      Yanking a drive mid-write is the single most common cause of a corrupt device
                      library — far more common than anything this app does.
                    </p>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmRestore !== null}
        onOpenChange={(next) => !next && setConfirmRestore(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              The drive's current library will be replaced by the snapshot from{' '}
              {confirmRestore && new Date(confirmRestore.createdAt).toLocaleString()}. The current
              state is snapshotted first, so you can undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRestore && handleRestore(confirmRestore)}>
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(next) => !next && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Both copies are removed from the drive. This cannot be undone — export it first if
              you might want it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

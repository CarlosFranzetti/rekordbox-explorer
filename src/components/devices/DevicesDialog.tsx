import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Download,
  HardDrive,
  Info,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { downloadBytes } from '@/lib/usb/fs';
import {
  buildRegistryAdvice,
  clearRegistry,
  exportRegistry,
  findCrossDeviceDuplicates,
  forgetDevice,
  importRegistry,
  listDevices,
  renameDevice,
  searchAllDevices,
  type DeviceRecord,
  type DuplicateGroup,
  type RegistryAdvice,
  type SearchHit,
} from '@/lib/device-registry';

interface DevicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DevicesDialog({ open, onOpenChange }: DevicesDialogProps) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [advice, setAdvice] = useState<RegistryAdvice[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDevices(await listDevices());
      setAdvice(await buildRegistryAdvice());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = query.trim().length >= 2 ? await searchAllDevices(query) : [];
      if (!cancelled) setHits(results);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const handleExport = async () => {
    const payload = await exportRegistry(true);
    downloadBytes(
      new TextEncoder().encode(JSON.stringify(payload, null, 2)),
      `device-registry-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json'
    );
    toast({ title: 'Registry exported', description: `${payload.devices.length} device(s).` });
  };

  const handleImport = async (file: File) => {
    try {
      const count = await importRegistry(JSON.parse(await file.text()));
      toast({ title: 'Registry imported', description: `${count} device(s) merged in.` });
      await refresh();
    } catch (caught) {
      toast({
        title: 'Import failed',
        description: caught instanceof Error ? caught.message : String(caught),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] w-[min(96vw,820px)] max-w-none flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            My drives
          </DialogTitle>
          <DialogDescription>
            An index of every drive you have opened here, so you can search across all of them
            without plugging anything in. Stored in this browser only.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
            {error}
          </p>
        )}

        <Tabs defaultValue="devices" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full shrink-0 grid-cols-3">
            <TabsTrigger value="devices">Drives ({devices.length})</TabsTrigger>
            <TabsTrigger value="search">Search all</TabsTrigger>
            <TabsTrigger value="advice">Advice</TabsTrigger>
          </TabsList>

          <TabsContent value="devices" className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5"
                onClick={handleExport}
                disabled={devices.length === 0}
              >
                <Download className="h-4 w-4" />
                Export index
              </Button>
              <label className="inline-flex">
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImport(file);
                    e.target.value = '';
                  }}
                />
                <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 text-sm hover:bg-accent">
                  <Upload className="h-4 w-4" />
                  Import index
                </span>
              </label>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-9 text-destructive"
                disabled={devices.length === 0}
                onClick={async () => {
                  await clearRegistry();
                  await refresh();
                  toast({ title: 'Registry cleared' });
                }}
              >
                Clear all
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2 pr-3">
                {loading && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin" />}
                {!loading && devices.length === 0 && (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    No drives indexed yet. Open a USB and it will appear here.
                  </p>
                )}
                {devices.map((device) => (
                  <div key={device.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        defaultValue={device.name}
                        aria-label={`Name for ${device.volumeName}`}
                        className="h-9 max-w-[240px] font-medium"
                        onBlur={async (e) => {
                          if (e.target.value !== device.name) {
                            await renameDevice(device.id, e.target.value);
                            await refresh();
                          }
                        }}
                      />
                      <Badge variant={device.libraries.hasPlus ? 'default' : 'secondary'}>
                        {device.libraries.hasPlus ? 'Legacy + Plus' : 'Legacy only'}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto h-9 w-9 text-destructive"
                        aria-label={`Forget ${device.name}`}
                        onClick={async () => {
                          await forgetDevice(device.id);
                          await refresh();
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {device.trackCount.toLocaleString()} tracks · {device.playlistCount} playlists
                      {device.backupCount > 0 && ` · ${device.backupCount} backups`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Volume "{device.volumeName}" · last seen{' '}
                      {new Date(device.lastSeen).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="search" className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a track across every drive…"
                className="h-10 pl-9"
              />
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 pr-3">
                {query.trim().length >= 2 && hits.length === 0 && (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    Not on any indexed drive.
                  </p>
                )}
                {hits.map((hit, i) => (
                  <div
                    key={`${hit.device.id}-${hit.track.id}-${i}`}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{hit.track.title}</span>
                      <span className="text-muted-foreground"> — {hit.track.artist}</span>
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {hit.device.name}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="advice" className="flex min-h-0 flex-1 flex-col gap-3">
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0 gap-1.5 self-start"
              onClick={async () => setDuplicates(await findCrossDeviceDuplicates())}
              disabled={devices.length < 2}
            >
              <Copy className="h-4 w-4" />
              Find tracks on more than one drive
            </Button>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2 pr-3">
                {advice.map((item, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                      item.severity === 'warning'
                        ? 'border-warning/30 bg-warning/10'
                        : 'border-border'
                    }`}
                  >
                    {item.severity === 'warning' ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    ) : (
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">{item.message}</span>
                  </div>
                ))}

                {duplicates.length > 0 && (
                  <div className="rounded-md border border-border p-3">
                    <p className="mb-2 text-sm font-medium">
                      {duplicates.length} track(s) on multiple drives
                    </p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {duplicates.slice(0, 100).map((group) => (
                        <li key={group.key} className="flex gap-2">
                          <span className="min-w-0 flex-1 truncate">
                            {group.title} — {group.artist}
                          </span>
                          <span className="shrink-0">{group.devices.length} drives</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

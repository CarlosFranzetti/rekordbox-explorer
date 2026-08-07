import { useEffect, useState } from 'react';
import { Minus, Moon, Plus, Settings, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  FONT_PRESETS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type SettingsApi,
} from '@/hooks/useSettings';
import { MAX_BACKUP_LIMIT, MIN_BACKUP_LIMIT } from '@/lib/usb/backup';
import { EXPORT_COLUMNS, EXPORT_COLUMN_LABEL } from '@/lib/export/exporters';

export type ColorScheme = 'dark' | 'midnight' | 'light' | 'arctic';

const SCHEMES: { value: ColorScheme; label: string; icon: typeof Sun }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'midnight', label: 'Midnight', icon: Moon },
  { value: 'light', label: 'Sepia', icon: Sun },
  { value: 'arctic', label: 'Arctic', icon: Sun },
];

const TABLE_COLUMNS = [
  { key: 'genre', label: 'Genre' },
  { key: 'bpm', label: 'BPM' },
  { key: 'duration', label: 'Duration' },
  { key: 'label', label: 'Label' },
  { key: 'year', label: 'Year' },
];

interface SettingsPanelProps {
  settings: SettingsApi;
}

export function SettingsPanel({ settings }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const { adjustFontSize } = settings;

  // Cmd/Ctrl + and − adjust table text size anywhere in the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        adjustFontSize(1);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        adjustFontSize(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [adjustFontSize]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88dvh] w-[min(96vw,560px)] max-w-none overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Everything here is stored in this browser only.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="appearance" className="flex min-h-0 flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="appearance">Look</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
            <TabsTrigger value="safety">Safety</TabsTrigger>
          </TabsList>

          <ScrollArea className="max-h-[58dvh]">
            <TabsContent value="appearance" className="space-y-6 pr-3">
              <section className="space-y-2">
                <Label className="text-sm text-muted-foreground">Colour scheme</Label>
                <div className="flex gap-2">
                  {SCHEMES.map((scheme) => {
                    const Icon = scheme.icon;
                    const isActive = settings.colorScheme === scheme.value;
                    return (
                      <Button
                        key={scheme.value}
                        variant={isActive ? 'default' : 'outline'}
                        size="icon"
                        title={scheme.label}
                        aria-label={scheme.label}
                        aria-pressed={isActive}
                        className={cn('h-11 w-11', isActive && 'bg-primary text-primary-foreground')}
                        onClick={() => settings.setColorScheme(scheme.value)}
                      >
                        <Icon className="h-4 w-4" />
                      </Button>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3">
                <Label className="text-sm text-muted-foreground">
                  Table text size — {settings.fontSize}px
                </Label>

                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={() => settings.adjustFontSize(-1)}
                    disabled={settings.fontSize <= MIN_FONT_SIZE}
                    aria-label="Smaller text"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Slider
                    value={[settings.fontSize]}
                    min={MIN_FONT_SIZE}
                    max={MAX_FONT_SIZE}
                    step={1}
                    onValueChange={([value]) => settings.setFontSize(value)}
                    aria-label="Table text size"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={() => settings.adjustFontSize(1)}
                    disabled={settings.fontSize >= MAX_FONT_SIZE}
                    aria-label="Larger text"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {FONT_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      variant={settings.fontSize === preset.size ? 'default' : 'outline'}
                      size="sm"
                      className="h-9"
                      onClick={() => settings.setFontSize(preset.size)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  ⌘/Ctrl + and − adjust this anywhere. "Booth" is sized to be readable at arm's
                  length in the dark.
                </p>
              </section>

              <section className="space-y-2">
                <Label className="text-sm text-muted-foreground">Table columns</Label>
                <div className="grid grid-cols-2 gap-3">
                  {TABLE_COLUMNS.map((column) => (
                    <div key={column.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`col-${column.key}`}
                        checked={!settings.hiddenColumns.includes(column.key)}
                        onCheckedChange={() => settings.toggleColumnVisibility(column.key)}
                      />
                      <label htmlFor={`col-${column.key}`} className="text-sm">
                        {column.label}
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Title, Artist and Album are always shown.
                </p>
              </section>
            </TabsContent>

            <TabsContent value="export" className="space-y-6 pr-3">
              <section className="space-y-2">
                <Label className="text-sm text-muted-foreground">Columns to export and print</Label>
                <div className="grid grid-cols-2 gap-3">
                  {EXPORT_COLUMNS.map((column) => (
                    <div key={column} className="flex items-center gap-2">
                      <Checkbox
                        id={`export-${column}`}
                        checked={settings.exportColumns.includes(column)}
                        onCheckedChange={() => settings.toggleExportColumn(column)}
                      />
                      <label htmlFor={`export-${column}`} className="text-sm">
                        {EXPORT_COLUMN_LABEL[column]}
                      </label>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <Label className="text-sm text-muted-foreground">PDF layout</Label>

                <div className="flex flex-wrap gap-2">
                  {(['a4', 'letter'] as const).map((size) => (
                    <Button
                      key={size}
                      size="sm"
                      className="h-9"
                      variant={settings.pdfPageSize === size ? 'default' : 'outline'}
                      onClick={() => settings.setPdfPageSize(size)}
                    >
                      {size === 'a4' ? 'A4' : 'US Letter'}
                    </Button>
                  ))}
                  {(['portrait', 'landscape'] as const).map((orientation) => (
                    <Button
                      key={orientation}
                      size="sm"
                      className="h-9 capitalize"
                      variant={settings.pdfOrientation === orientation ? 'default' : 'outline'}
                      onClick={() => settings.setPdfOrientation(orientation)}
                    >
                      {orientation}
                    </Button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="pdf-numbers" className="text-sm font-normal">
                    Number the rows
                  </Label>
                  <Switch
                    id="pdf-numbers"
                    checked={settings.pdfIncludeNumbers}
                    onCheckedChange={settings.setPdfIncludeNumbers}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="pdf-footer" className="text-sm font-normal">
                    Page numbers in the footer
                  </Label>
                  <Switch
                    id="pdf-footer"
                    checked={settings.pdfIncludeFooter}
                    onCheckedChange={settings.setPdfIncludeFooter}
                  />
                </div>
              </section>
            </TabsContent>

            <TabsContent value="safety" className="space-y-6 pr-3">
              <section className="space-y-3">
                <Label className="text-sm text-muted-foreground">
                  Backups kept per drive — {settings.backupLimit}
                </Label>
                <Slider
                  value={[settings.backupLimit]}
                  min={MIN_BACKUP_LIMIT}
                  max={MAX_BACKUP_LIMIT}
                  step={1}
                  onValueChange={([value]) => settings.setBackupLimit(value)}
                  aria-label="Number of backups to keep"
                />
                <p className="text-xs text-muted-foreground">
                  Each snapshot is written twice, in two different folders on the drive. Older
                  snapshots beyond this count are pruned after a new one is safely stored.
                </p>
              </section>

              <section className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="backup-open" className="text-sm font-normal">
                    Back up when a drive is opened
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Takes one snapshot the first time you open each drive, so you always have a
                    known-good starting point.
                  </p>
                </div>
                <Switch
                  id="backup-open"
                  checked={settings.backupOnOpen}
                  onCheckedChange={settings.setBackupOnOpen}
                />
              </section>

              <section className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">What this app will never touch</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">
                  <li>Your audio files</li>
                  <li>Analysis data — waveforms, beatgrids, hot cues, memory points</li>
                  <li>Track, artist, album or artwork records in the database</li>
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Only playlist tables are rewritten, and only by appending new pages. Existing
                  data stays byte-for-byte intact.
                </p>
              </section>

              <Button variant="outline" size="sm" className="h-9" onClick={settings.resetSettings}>
                Reset all settings
              </Button>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

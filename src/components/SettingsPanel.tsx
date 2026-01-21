import { useState, useEffect } from 'react';
import { Settings, Sun, Moon, Monitor, Plus, Minus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export type ColorScheme = 'dark' | 'midnight' | 'light' | 'arctic';

interface SettingsPanelProps {
  colorScheme: ColorScheme;
  onColorSchemeChange: (scheme: ColorScheme) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  hiddenColumns: string[];
  onToggleColumn: (key: string) => void;
}

const schemes: { value: ColorScheme; label: string; icon: typeof Sun }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'midnight', label: 'Midnight', icon: Moon },
  { value: 'light', label: 'Sepia', icon: Sun },
  { value: 'arctic', label: 'Arctic', icon: Sun },
];

const toggleableColumns = [
  { key: 'genre', label: 'Genre' },
  { key: 'bpm', label: 'BPM' },
  { key: 'duration', label: 'Duration' },
  { key: 'label', label: 'Label' },
  { key: 'year', label: 'Year' },
];

export function SettingsPanel({
  colorScheme,
  onColorSchemeChange,
  fontSize,
  onFontSizeChange,
  hiddenColumns,
  onToggleColumn,
}: SettingsPanelProps) {
  const [open, setOpen] = useState(false);

  // Keyboard shortcuts for font size
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        onFontSizeChange(Math.min(fontSize + 1, 20));
      } else if ((e.metaKey || e.ctrlKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        onFontSizeChange(Math.max(fontSize - 1, 10));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fontSize, onFontSizeChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 bg-popover p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground">Settings</h3>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Color Scheme */}
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">Color Scheme</Label>
            <div className="flex gap-2">
              {schemes.map((scheme) => {
                const Icon = scheme.icon;
                const isActive = colorScheme === scheme.value;

                return (
                  <Button
                    key={scheme.value}
                    variant={isActive ? 'default' : 'outline'}
                    size="icon"
                    title={scheme.label}
                    aria-label={scheme.label}
                    className={cn('h-9 w-9', isActive && 'bg-primary text-primary-foreground')}
                    onClick={() => onColorSchemeChange(scheme.value)}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                );
              })}
            </div>
        </div>

        {/* Font Size */}
        <div className="mt-4 space-y-2">
          <Label className="text-sm text-muted-foreground">
            Font Size ({fontSize}px)
          </Label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onFontSizeChange(Math.max(fontSize - 1, 10))}
              disabled={fontSize <= 10}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${((fontSize - 10) / 10) * 100}%` }}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onFontSizeChange(Math.min(fontSize + 1, 20))}
              disabled={fontSize >= 20}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use ⌘/Ctrl + / − to adjust
          </p>
        </div>

        {/* Column Visibility */}
        <div className="mt-4 space-y-2">
          <Label className="text-sm text-muted-foreground">Visible Columns</Label>
          <div className="grid grid-cols-2 gap-2">
            {toggleableColumns.map((col) => (
              <div key={col.key} className="flex items-center space-x-2">
                <Checkbox
                  id={`col-${col.key}`}
                  checked={!hiddenColumns.includes(col.key)}
                  onCheckedChange={() => onToggleColumn(col.key)}
                />
                <label
                  htmlFor={`col-${col.key}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {col.label}
                </label>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Title, Artist, and Album are always visible.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

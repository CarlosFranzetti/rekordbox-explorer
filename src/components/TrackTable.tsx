import { useState, useCallback } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatDuration, formatBpm } from '@/lib/rekordbox-parser';
import type { Track, SortColumn, SortDirection } from '@/types/rekordbox';

interface TrackTableProps {
  tracks: Track[];
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
}

interface ColumnConfig {
  key: SortColumn;
  label: string;
  defaultWidth: number;
  minWidth: number;
}

const COLUMNS: ColumnConfig[] = [
  { key: 'title', label: 'Title', defaultWidth: 240, minWidth: 100 },
  { key: 'artist', label: 'Artist', defaultWidth: 180, minWidth: 80 },
  { key: 'album', label: 'Album', defaultWidth: 180, minWidth: 80 },
  { key: 'duration', label: 'Duration', defaultWidth: 90, minWidth: 70 },
  { key: 'bpm', label: 'BPM', defaultWidth: 70, minWidth: 50 },
  { key: 'key', label: 'Key', defaultWidth: 60, minWidth: 50 },
];

interface ResizeHandleProps {
  onResize: (delta: number) => void;
}

function ResizeHandle({ onResize }: ResizeHandleProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        onResize(delta);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [onResize]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/50 active:bg-primary"
    />
  );
}

export function TrackTable({ tracks, sortColumn, sortDirection, onSort }: TrackTableProps) {
  const [columnWidths, setColumnWidths] = useState<Record<SortColumn, number>>(() =>
    COLUMNS.reduce((acc, col) => ({ ...acc, [col.key]: col.defaultWidth }), {} as Record<SortColumn, number>)
  );

  const handleResize = useCallback((columnKey: SortColumn, delta: number) => {
    setColumnWidths((prev) => {
      const col = COLUMNS.find((c) => c.key === columnKey);
      const newWidth = Math.max(col?.minWidth ?? 50, prev[columnKey] + delta);
      return { ...prev, [columnKey]: newWidth };
    });
  }, []);

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>No tracks found</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader className="sticky top-0 z-20 bg-primary text-primary-foreground">
          <TableRow className="border-border hover:bg-primary/90">
            {COLUMNS.map((col) => (
              <TableHead
                key={col.key}
                className="relative cursor-pointer select-none bg-primary text-primary-foreground hover:bg-primary/80"
                style={{ width: columnWidths[col.key], minWidth: col.minWidth }}
                onClick={() => onSort(col.key)}
              >
                <div className="flex items-center gap-1 pr-2">
                  <span>{col.label}</span>
                  {sortColumn === col.key &&
                    (sortDirection === 'asc' ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    ))}
                </div>
                <ResizeHandle onResize={(delta) => handleResize(col.key, delta)} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tracks.map((track, index) => (
            <TableRow key={track.id || index} className="border-border transition-colors hover:bg-row-hover">
              <TableCell style={{ width: columnWidths.title }} className="truncate font-medium">
                {track.title || 'Unknown'}
              </TableCell>
              <TableCell style={{ width: columnWidths.artist }} className="truncate text-muted-foreground">
                {track.artist || 'Unknown'}
              </TableCell>
              <TableCell style={{ width: columnWidths.album }} className="truncate text-muted-foreground">
                {track.album || ''}
              </TableCell>
              <TableCell style={{ width: columnWidths.duration }} className="tabular-nums text-muted-foreground">
                {formatDuration(track.duration)}
              </TableCell>
              <TableCell style={{ width: columnWidths.bpm }} className="tabular-nums text-muted-foreground">
                {formatBpm(track.bpm)}
              </TableCell>
              <TableCell style={{ width: columnWidths.key }} className="text-muted-foreground">
                {track.key || ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
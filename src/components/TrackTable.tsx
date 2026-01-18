import { useState, useCallback, useRef } from 'react';
import { ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  { key: 'title', label: 'Title', defaultWidth: 280, minWidth: 100 },
  { key: 'artist', label: 'Artist', defaultWidth: 200, minWidth: 80 },
  { key: 'album', label: 'Album', defaultWidth: 200, minWidth: 80 },
  { key: 'duration', label: 'Duration', defaultWidth: 90, minWidth: 70 },
  { key: 'bpm', label: 'BPM', defaultWidth: 70, minWidth: 50 },
  { key: 'key', label: 'Key', defaultWidth: 60, minWidth: 50 },
];

interface ResizeHandleProps {
  onResizeStart: (e: React.MouseEvent) => void;
}

function ResizeHandle({ onResizeStart }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onResizeStart}
      className="absolute right-0 top-0 z-10 flex h-full w-2 cursor-col-resize items-center justify-center bg-transparent hover:bg-white/20 active:bg-white/30"
    >
      <GripVertical className="h-4 w-4 text-white/40" />
    </div>
  );
}

export function TrackTable({ tracks, sortColumn, sortDirection, onSort }: TrackTableProps) {
  const [columnWidths, setColumnWidths] = useState<Record<SortColumn, number>>(() =>
    COLUMNS.reduce((acc, col) => ({ ...acc, [col.key]: col.defaultWidth }), {} as Record<SortColumn, number>)
  );
  const draggingRef = useRef<{ key: SortColumn; startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback((columnKey: SortColumn, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = {
      key: columnKey,
      startX: e.clientX,
      startWidth: columnWidths[columnKey],
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      const col = COLUMNS.find((c) => c.key === draggingRef.current!.key);
      const delta = moveEvent.clientX - draggingRef.current.startX;
      const newWidth = Math.max(col?.minWidth ?? 50, draggingRef.current.startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [draggingRef.current!.key]: newWidth }));
    };

    const onMouseUp = () => {
      draggingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [columnWidths]);

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>No tracks found</p>
      </div>
    );
  }

  const totalWidth = Object.values(columnWidths).reduce((sum, w) => sum + w, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Fixed Header */}
      <div className="shrink-0 overflow-x-auto bg-primary">
        <div style={{ minWidth: totalWidth }}>
          <Table>
            <TableHeader>
              <TableRow className="border-none hover:bg-transparent">
                {COLUMNS.map((col) => (
                  <TableHead
                    key={col.key}
                    className="relative h-10 cursor-pointer select-none border-none bg-primary text-primary-foreground hover:bg-primary/90"
                    style={{ width: columnWidths[col.key], minWidth: col.minWidth }}
                    onClick={() => onSort(col.key)}
                  >
                    <div className="flex items-center gap-1 pr-4">
                      <span style={{ fontSize: 'var(--table-font-size)' }}>{col.label}</span>
                      {sortColumn === col.key &&
                        (sortDirection === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        ))}
                    </div>
                    <ResizeHandle onResizeStart={(e) => handleResizeStart(col.key, e)} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
          </Table>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: totalWidth }}>
          <Table>
            <TableBody>
              {tracks.map((track, index) => (
                <TableRow
                  key={track.id || index}
                  className="border-border transition-colors hover:bg-row-hover"
                  style={{ fontSize: 'var(--table-font-size)' }}
                >
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
        </div>
      </div>
    </div>
  );
}
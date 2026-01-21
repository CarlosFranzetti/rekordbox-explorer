import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDuration, formatBpm } from '@/lib/rekordbox-parser';
import type { Track, SortColumn, SortDirection } from '@/types/rekordbox';
import { useIsMobile } from '@/hooks/use-mobile';

const COLUMN_WIDTHS_KEY = 'rekordbox-column-widths';
const COLUMN_ORDER_KEY = 'rekordbox-column-order';

interface TrackTableProps {
  tracks: Track[];
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
  hiddenColumns: string[];
}

interface ColumnConfig {
  key: SortColumn;
  label: string;
  defaultWidth: number;
  minWidth: number;
}

// Desktop: Title, Artist, Album, Genre, Duration, BPM
const DESKTOP_COLUMNS: ColumnConfig[] = [
  { key: 'title', label: 'Title', defaultWidth: 280, minWidth: 140 },
  { key: 'artist', label: 'Artist', defaultWidth: 200, minWidth: 120 },
  { key: 'album', label: 'Album', defaultWidth: 200, minWidth: 120 },
  { key: 'label', label: 'Label', defaultWidth: 150, minWidth: 100 },
  { key: 'genre', label: 'Genre', defaultWidth: 140, minWidth: 100 },
  { key: 'year', label: 'Year', defaultWidth: 60, minWidth: 50 },
  { key: 'duration', label: 'Duration', defaultWidth: 90, minWidth: 80 },
  { key: 'bpm', label: 'BPM', defaultWidth: 80, minWidth: 70 },
];

// Mobile/iOS: Title, Artist, Album only (no splitters, optimized for readability)
const MOBILE_COLUMNS: ColumnConfig[] = [
  { key: 'title', label: 'Title', defaultWidth: 160, minWidth: 100 },
  { key: 'artist', label: 'Artist', defaultWidth: 120, minWidth: 80 },
  { key: 'album', label: 'Album', defaultWidth: 120, minWidth: 80 },
];

function getStoredWidths(): Record<string, number> | null {
  try {
    const stored = localStorage.getItem(COLUMN_WIDTHS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

function getDefaultWidths(): Record<string, number> {
  return DESKTOP_COLUMNS.reduce(
    (acc, col) => ({ ...acc, [col.key]: col.defaultWidth }),
    {} as Record<string, number>
  );
}

function getStoredColumnOrder(): string[] | null {
  try {
    const stored = localStorage.getItem(COLUMN_ORDER_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore
  }
  return null;
}

interface ResizeHandleProps {
  onResizeStart: (e: React.MouseEvent) => void;
}

function ResizeHandle({ onResizeStart }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onResizeStart}
      className="absolute right-0 top-0 z-10 flex h-full w-2 cursor-col-resize items-center justify-center bg-transparent hover:bg-primary-foreground/10 active:bg-primary-foreground/15"
    >
      <GripVertical className="h-4 w-4 text-primary-foreground/50" />
    </div>
  );
}

export function TrackTable({ tracks, sortColumn, sortDirection, onSort, hiddenColumns }: TrackTableProps) {
  const isMobile = useIsMobile();

  // Load widths from localStorage on mount, fallback to defaults
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => getStoredWidths() ?? getDefaultWidths()
  );

  const [columnOrder, setColumnOrder] = useState<string[]>(
    () => getStoredColumnOrder() ?? DESKTOP_COLUMNS.map(c => c.key)
  );

  const activeColumns = useMemo(() => {
    if (isMobile) return MOBILE_COLUMNS;
    
    // Filter out hidden columns (but keep mandatory ones: title, artist, album)
    const visibleColumns = DESKTOP_COLUMNS.filter(col => {
      if (['title', 'artist', 'album'].includes(col.key)) return true;
      return !hiddenColumns.includes(col.key);
    });
    
    // Return columns sorted by columnOrder
    return [...visibleColumns].sort((a, b) => {
      const idxA = columnOrder.indexOf(a.key);
      const idxB = columnOrder.indexOf(b.key);
      // If a new column is added but not in order, put it at the end
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }, [isMobile, columnOrder, hiddenColumns]);

  // Persist order
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(columnOrder));
    } catch {
      // ignore
    }
  }, [columnOrder]);

  // Persist widths to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
    } catch {
      // ignore storage errors
    }
  }, [columnWidths]);

  const draggingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, columnKey: string) => {
    setDraggedColumn(columnKey);
    e.dataTransfer.effectAllowed = 'move';
    // Set transparent image or default
  };

  const handleDragOver = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetKey) return;
  };

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetKey) return;

    const newOrder = [...columnOrder];
    const oldIndex = newOrder.indexOf(draggedColumn);
    const newIndex = newOrder.indexOf(targetKey);

    if (oldIndex !== -1 && newIndex !== -1) {
      newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, draggedColumn);
      setColumnOrder(newOrder);
    }
    setDraggedColumn(null);
  };

  const handleResizeStart = useCallback(
    (columnKey: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      draggingRef.current = {
        key: columnKey,
        startX: e.clientX,
        startWidth: columnWidths[columnKey] ?? 100,
      };

      const onMouseMove = (moveEvent: MouseEvent) => {
        const current = draggingRef.current;
        if (!current) return;
        const col = DESKTOP_COLUMNS.find((c) => c.key === current.key);
        const delta = moveEvent.clientX - current.startX;
        const newWidth = Math.max(col?.minWidth ?? 60, current.startWidth + delta);
        setColumnWidths((prev) => ({ ...prev, [current.key]: newWidth }));
      };

      const onMouseUp = () => {
        draggingRef.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [columnWidths]
  );

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>No tracks found</p>
      </div>
    );
  }

  // On mobile, use flexible widths; on desktop, use fixed widths from state
  const totalWidth = isMobile
    ? undefined
    : activeColumns.reduce((sum, c) => sum + (columnWidths[c.key] ?? c.defaultWidth), 0);

  return (
    <div className="h-full overflow-auto">
      <table
        className={`w-full caption-bottom text-sm ${isMobile ? '' : 'table-fixed'}`}
        style={totalWidth ? { minWidth: totalWidth } : undefined}
      >
        {/* colgroup ensures header and body columns share widths */}
        {!isMobile && (
          <colgroup>
            {activeColumns.map((c) => (
              <col key={c.key} style={{ width: columnWidths[c.key] ?? c.defaultWidth }} />
            ))}
          </colgroup>
        )}

        <TableHeader className="sticky top-0 z-20 bg-primary">
          <TableRow className="border-none hover:bg-transparent">
            {activeColumns.map((col, idx) => (
              <TableHead
                key={col.key}
                draggable={!isMobile}
                onDragStart={(e) => !isMobile && handleDragStart(e, col.key)}
                onDragOver={(e) => !isMobile && handleDragOver(e, col.key)}
                onDrop={(e) => !isMobile && handleDrop(e, col.key)}
                className={`relative h-10 cursor-pointer select-none border-none bg-primary text-primary-foreground hover:bg-primary/90 ${
                  draggedColumn === col.key ? 'opacity-50' : ''
                }`}
                style={isMobile ? undefined : { width: columnWidths[col.key] ?? col.defaultWidth }}
                onClick={() => onSort(col.key)}
              >
                <div className="flex items-center gap-1 pr-4">
                  <span
                    className={isMobile ? 'text-xs' : ''}
                    style={isMobile ? undefined : { fontSize: 'var(--table-font-size)' }}
                  >
                    {col.label}
                  </span>
                  {sortColumn === col.key &&
                    (sortDirection === 'asc' ? (
                      <ArrowUp className="h-3 w-3 shrink-0" />
                    ) : (
                      <ArrowDown className="h-3 w-3 shrink-0" />
                    ))}
                </div>

                {/* Resize handles only on desktop, not for last column */}
                {!isMobile && idx < activeColumns.length - 1 && (
                  <ResizeHandle onResizeStart={(e) => handleResizeStart(col.key, e)} />
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {tracks.map((track, index) => (
            <TableRow
              key={track.id || index}
              className="border-border transition-colors hover:bg-row-hover"
              style={isMobile ? undefined : { fontSize: 'var(--table-font-size)' }}
            >
              {activeColumns.map((col) => {
                const cellStyle = isMobile ? undefined : { width: columnWidths[col.key] ?? col.defaultWidth };
                const mobileClass = isMobile ? 'text-xs py-2 px-2' : '';

                switch (col.key) {
                  case 'title':
                    return (
                      <TableCell key="title" style={cellStyle} className={`truncate font-medium ${mobileClass}`}>
                        {track.title || 'Unknown'}
                      </TableCell>
                    );
                  case 'artist':
                    return (
                      <TableCell
                        key="artist"
                        style={cellStyle}
                        className={`truncate text-muted-foreground ${mobileClass}`}
                      >
                        {track.artist || 'Unknown'}
                      </TableCell>
                    );
                  case 'album':
                    return (
                      <TableCell
                        key="album"
                        style={cellStyle}
                        className={`truncate text-muted-foreground ${mobileClass}`}
                      >
                        {track.album || ''}
                      </TableCell>
                    );
                  case 'genre':
                    return (
                      <TableCell
                        key="genre"
                        style={cellStyle}
                        className={`truncate text-muted-foreground ${mobileClass}`}
                      >
                        {track.genre || ''}
                      </TableCell>
                    );
                  case 'label':
                    return (
                      <TableCell
                        key="label"
                        style={cellStyle}
                        className={`truncate text-muted-foreground ${mobileClass}`}
                      >
                        {track.label || ''}
                      </TableCell>
                    );
                  case 'year':
                    return (
                      <TableCell
                        key="year"
                        style={cellStyle}
                        className={`tabular-nums text-muted-foreground ${mobileClass}`}
                      >
                        {track.year || ''}
                      </TableCell>
                    );
                  case 'duration':
                    return (
                      <TableCell
                        key="duration"
                        style={cellStyle}
                        className={`tabular-nums text-muted-foreground ${mobileClass}`}
                      >
                        {formatDuration(track.duration)}
                      </TableCell>
                    );
                  case 'bpm':
                    return (
                      <TableCell
                        key="bpm"
                        style={cellStyle}
                        className={`tabular-nums text-muted-foreground ${mobileClass}`}
                      >
                        {formatBpm(track.bpm)}
                      </TableCell>
                    );
                  default:
                    return null;
                }
              })}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}

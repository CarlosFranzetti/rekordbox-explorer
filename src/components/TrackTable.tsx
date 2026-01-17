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

interface SortHeaderProps {
  column: SortColumn;
  label: string;
  currentColumn: SortColumn;
  direction: SortDirection;
  onSort: (column: SortColumn) => void;
  className?: string;
}

function SortHeader({ column, label, currentColumn, direction, onSort, className }: SortHeaderProps) {
  const isActive = column === currentColumn;
  
  return (
    <TableHead 
      className={cn("cursor-pointer select-none hover:bg-muted/50", className)}
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {isActive && (
          direction === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        )}
      </div>
    </TableHead>
  );
}

export function TrackTable({ tracks, sortColumn, sortDirection, onSort }: TrackTableProps) {
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
        <TableHeader className="sticky top-0 bg-background">
          <TableRow className="border-border hover:bg-transparent">
            <SortHeader
              column="title"
              label="Title"
              currentColumn={sortColumn}
              direction={sortDirection}
              onSort={onSort}
              className="min-w-[200px]"
            />
            <SortHeader
              column="artist"
              label="Artist"
              currentColumn={sortColumn}
              direction={sortDirection}
              onSort={onSort}
              className="min-w-[150px]"
            />
            <SortHeader
              column="album"
              label="Album"
              currentColumn={sortColumn}
              direction={sortDirection}
              onSort={onSort}
              className="min-w-[150px]"
            />
            <SortHeader
              column="duration"
              label="Duration"
              currentColumn={sortColumn}
              direction={sortDirection}
              onSort={onSort}
              className="w-24"
            />
            <SortHeader
              column="bpm"
              label="BPM"
              currentColumn={sortColumn}
              direction={sortDirection}
              onSort={onSort}
              className="w-20"
            />
            <SortHeader
              column="key"
              label="Key"
              currentColumn={sortColumn}
              direction={sortDirection}
              onSort={onSort}
              className="w-16"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tracks.map((track, index) => (
            <TableRow 
              key={track.id || index}
              className="border-border transition-colors hover:bg-row-hover"
            >
              <TableCell className="font-medium">{track.title || 'Unknown'}</TableCell>
              <TableCell className="text-muted-foreground">{track.artist || 'Unknown'}</TableCell>
              <TableCell className="text-muted-foreground">{track.album || ''}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">
                {formatDuration(track.duration)}
              </TableCell>
              <TableCell className="tabular-nums text-muted-foreground">
                {formatBpm(track.bpm)}
              </TableCell>
              <TableCell className="text-muted-foreground">{track.key || ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
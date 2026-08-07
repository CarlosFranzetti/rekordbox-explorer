import { Download, FileCode, FileJson, FileSpreadsheet, FileText, ListMusic, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { downloadBytes, safeFileName } from '@/lib/usb/fs';
import { exportTracksToPdf, printTracks } from '@/lib/pdf-export';
import {
  libraryToJson,
  libraryToRekordboxXml,
  tracksToCsv,
  tracksToM3u8,
  tracksToText,
  type ExportColumn,
} from '@/lib/export/exporters';
import type { Playlist, Track } from '@/types/rekordbox';

interface ExportMenuProps {
  tracks: Track[];
  playlists: Playlist[];
  playlistName: string;
  columns: ExportColumn[];
  pdfPageSize: 'a4' | 'letter';
  pdfOrientation: 'portrait' | 'landscape';
  pdfIncludeNumbers: boolean;
  pdfIncludeFooter: boolean;
}

export function ExportMenu({
  tracks,
  playlists,
  playlistName,
  columns,
  pdfPageSize,
  pdfOrientation,
  pdfIncludeNumbers,
  pdfIncludeFooter,
}: ExportMenuProps) {
  const { toast } = useToast();

  const save = (content: string, extension: string, mime: string) => {
    downloadBytes(
      new TextEncoder().encode(content),
      `${safeFileName(playlistName, 'library')}.${extension}`,
      mime
    );
  };

  const guard = (label: string, action: () => void | Promise<void>) => () => {
    if (tracks.length === 0) {
      toast({ title: 'Nothing to export', description: 'This view has no tracks.' });
      return;
    }
    const fail = (error: unknown) =>
      toast({
        title: `${label} failed`,
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });

    try {
      const result = action();
      if (result instanceof Promise) void result.catch(fail);
    } catch (error) {
      fail(error);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" aria-label="Export or print">
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>This view ({tracks.length} tracks)</DropdownMenuLabel>

        <DropdownMenuItem
          onSelect={guard('PDF export', () =>
            exportTracksToPdf(tracks, playlistName, {
              columns,
              pageSize: pdfPageSize,
              orientation: pdfOrientation,
              includeNumbers: pdfIncludeNumbers,
              includeFooter: pdfIncludeFooter,
            })
          )}
        >
          <FileText className="mr-2 h-4 w-4" />
          PDF setlist
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={guard('Print', () => printTracks(tracks, playlistName, columns))}>
          <Printer className="mr-2 h-4 w-4" />
          Print…
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={guard('CSV export', () =>
            save(tracksToCsv(tracks, columns), 'csv', 'text/csv;charset=utf-8')
          )}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          CSV spreadsheet
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={guard('M3U8 export', () =>
            save(tracksToM3u8(tracks, playlistName), 'm3u8', 'audio/x-mpegurl')
          )}
        >
          <ListMusic className="mr-2 h-4 w-4" />
          M3U8 playlist
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={guard('Text export', () =>
            save(tracksToText(tracks, playlistName, columns), 'txt', 'text/plain;charset=utf-8')
          )}
        >
          <FileText className="mr-2 h-4 w-4" />
          Plain text
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Whole library</DropdownMenuLabel>

        <DropdownMenuItem
          onSelect={() =>
            save(
              libraryToRekordboxXml(tracks, playlists),
              'xml',
              'application/xml;charset=utf-8'
            )
          }
        >
          <FileCode className="mr-2 h-4 w-4" />
          rekordbox XML
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={() =>
            save(libraryToJson(tracks, playlists), 'json', 'application/json;charset=utf-8')
          }
        >
          <FileJson className="mr-2 h-4 w-4" />
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Folder, File, ArrowUp } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/rekordbox-parser';
import type { FileEntry } from '@/types/rekordbox';

interface FileBrowserProps {
  entries: FileEntry[];
  path: string[];
  onNavigate: (handle: FileSystemDirectoryHandle, name: string) => void;
  onNavigateUp: () => void;
}

export function FileBrowser({ entries, path, onNavigate, onNavigateUp }: FileBrowserProps) {
  const canGoUp = path.length > 1;

  return (
    <div className="flex h-full flex-col">
      {/* Path bar */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          disabled={!canGoUp}
          onClick={onNavigateUp}
          className="h-8 w-8"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1 text-sm">
          {path.map((segment, index) => (
            <span key={index} className="flex items-center gap-1">
              {index > 0 && <span className="text-muted-foreground">/</span>}
              <span className={index === path.length - 1 ? 'text-foreground' : 'text-muted-foreground'}>
                {segment}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* File list */}
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="min-w-[300px]">Name</TableHead>
              <TableHead className="w-24 text-right">Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                  Empty folder
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry, index) => (
                <TableRow 
                  key={index}
                  className="cursor-pointer border-border transition-colors hover:bg-row-hover"
                  onClick={() => {
                    if (entry.isDirectory) {
                      onNavigate(entry.handle as FileSystemDirectoryHandle, entry.name);
                    }
                  }}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {entry.isDirectory ? (
                        <Folder className="h-4 w-4 text-primary" />
                      ) : (
                        <File className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={entry.isDirectory ? 'font-medium' : ''}>
                        {entry.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {entry.isDirectory ? '--' : formatFileSize(entry.size || 0)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
import { HardDrive, Usb, AlertCircle, Loader2, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { USBStatus } from '@/types/rekordbox';
import { isFileSystemAccessSupported } from '@/hooks/useRekordbox';

interface LandingScreenProps {
  status: USBStatus;
  onSelectFolder: () => void;
  onFullScan: () => void;
  onReset: () => void;
  onSelectFile?: () => void;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  onFileInput?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function LandingScreen({ status, onSelectFolder, onFullScan, onReset, onSelectFile, fileInputRef, onFileInput }: LandingScreenProps) {
  const supportsFileSystemAccess = isFileSystemAccessSupported();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {/* Hidden file input for Safari/iOS fallback */}
      {fileInputRef && onFileInput && (
        <input
          ref={fileInputRef}
          type="file"
          onChange={onFileInput}
          className="hidden"
        />
      )}
      
      <Card className="w-full max-w-md animate-fade-in border-border bg-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <HardDrive className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold text-foreground">
            RekordboxViewer
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Browse your Rekordbox USB library without loading the full app
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {status.type === 'idle' && supportsFileSystemAccess && (
            <Button 
              onClick={onSelectFolder} 
              className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              size="lg"
            >
              <Usb className="h-5 w-5" />
              Select USB or Folder
            </Button>
          )}

          {status.type === 'idle' && !supportsFileSystemAccess && onSelectFile && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
                <div className="text-sm text-muted-foreground">
                  <p className="mb-1">Your browser doesn't support folder selection.</p>
                  <p>Navigate to your USB in the Files app, find <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">PIONEER/rekordbox/</code> and select <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">export.pdb</code></p>
                </div>
              </div>
              <Button 
                onClick={onSelectFile} 
                className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                size="lg"
              >
                <FileUp className="h-5 w-5" />
                Select export.pdb File
              </Button>
            </div>
          )}

          {status.type === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Scanning for Rekordbox database...</p>
            </div>
          )}

          {status.type === 'partial' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
                <div>
                  <p className="font-medium text-foreground">Partial Structure Found</p>
                  <p className="mt-1 text-sm text-muted-foreground">{status.message}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={onFullScan} 
                  variant="default"
                  className="flex-1"
                >
                  Full Scan
                </Button>
                <Button 
                  onClick={onReset} 
                  variant="outline"
                  className="flex-1"
                >
                  Choose Another
                </Button>
              </div>
            </div>
          )}

          {status.type === 'invalid' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                <div>
                  <p className="font-medium text-foreground">Not a Rekordbox USB</p>
                  <p className="mt-1 text-sm text-muted-foreground">{status.message}</p>
                </div>
              </div>
              <Button 
                onClick={onReset} 
                variant="outline"
                className="w-full"
              >
                Choose Another Folder
              </Button>
            </div>
          )}

          {status.type === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                <div>
                  <p className="font-medium text-foreground">Error</p>
                  <p className="mt-1 text-sm text-muted-foreground">{status.message}</p>
                </div>
              </div>
              {/* Show file picker on Safari/unsupported browsers instead of Try Again */}
              {!supportsFileSystemAccess && onSelectFile ? (
                <Button 
                  onClick={onSelectFile} 
                  className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                  size="lg"
                >
                  <FileUp className="h-5 w-5" />
                  Select export.pdb File
                </Button>
              ) : (
                <Button 
                  onClick={onReset} 
                  variant="outline"
                  className="w-full"
                >
                  Try Again
                </Button>
              )}
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Looks for <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">PIONEER/rekordbox/export.pdb</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
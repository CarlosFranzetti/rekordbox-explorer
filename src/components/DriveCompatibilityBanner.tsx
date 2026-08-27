import { useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DriveReport } from '@/types/rekordbox';

/**
 * A one-line verdict on whether this drive will work in the booth.
 *
 * The landing screen shows the full report, but a drive that loads fine never
 * passes through that state — you go straight to the library. That is exactly
 * the case worth warning about: a legacy-only stick opens perfectly here and
 * then does not appear on an OPUS-QUAD, and a OneLibrary-only stick is
 * invisible to every older CDJ.
 *
 * Stays quiet when there is nothing to say. Expands for the detail, and can be
 * dismissed for the session.
 */
export function DriveCompatibilityBanner({ drive }: { drive: DriveReport }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { compatibility, playlistComparison } = drive;
  const mismatched = playlistComparison && !playlistComparison.equivalent;
  const blocked = compatibility.olderPlayers === 'no' || compatibility.newerPlayers === 'no';
  const hasDetail = compatibility.warnings.length > 0 || mismatched;

  // Nothing worth interrupting for: works everywhere, both libraries agree.
  if (dismissed || (!blocked && !hasDetail)) return null;

  const severe = blocked || mismatched;

  return (
    <div
      className={`shrink-0 border-b px-3 py-2 sm:px-4 ${
        severe ? 'border-warning/30 bg-warning/10' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-start gap-2">
        {severe ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        ) : (
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">{compatibility.headline}</p>
          {mismatched && (
            <p className="mt-0.5 text-xs text-muted-foreground">{playlistComparison.summary}</p>
          )}

          {expanded && (
            <div className="mt-2 space-y-1.5">
              {compatibility.warnings.map((w) => (
                <p key={w} className="text-xs text-muted-foreground">
                  {w}
                </p>
              ))}
              {mismatched && (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {playlistComparison.onlyInLegacy.map((n) => (
                    <li key={`l-${n}`}>· “{n}” — older players only</li>
                  ))}
                  {playlistComparison.onlyInOneLibrary.map((n) => (
                    <li key={`o-${n}`}>· “{n}” — newer players only</li>
                  ))}
                  {playlistComparison.differingCounts.map((d) => (
                    <li key={`d-${d.name}`}>
                      · “{d.name}” — {d.legacyCount} tracks on older, {d.oneLibraryCount} on newer
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {hasDetail && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span className="ml-1 hidden sm:inline">{expanded ? 'Less' : 'Details'}</span>
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss compatibility notice"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

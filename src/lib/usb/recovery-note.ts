/**
 * Generates the plain-text recovery note dropped at the USB root.
 *
 * Deliberately a `.txt` at the top level: if the library is broken, the person
 * reading this is standing in a booth with a laptop and no internet. It has to
 * be findable and readable with nothing but a file manager.
 */

import { APP_NAME, APP_URL } from '@/lib/version';

export const RECOVERY_NOTE_FILENAME = 'WHATTODOIFTHISWENTTOSHIT.txt';

export interface RecoveryNoteContext {
  writtenAt: Date;
  primaryVaultPath: string;
  mirrorVaultPath: string;
  databasePath: string;
  backupIds: string[];
}

export function buildRecoveryNote(context: RecoveryNoteContext): string {
  const { writtenAt, primaryVaultPath, mirrorVaultPath, databasePath, backupIds } = context;

  const backupList =
    backupIds.length > 0
      ? backupIds.map((id, i) => `      ${i + 1}. ${id}`).join('\n')
      : '      (none yet)';

  return `================================================================
 WHAT TO DO IF THIS WENT TO SHIT
 ${APP_NAME} — USB recovery instructions
 Written: ${writtenAt.toISOString()}
================================================================

DON'T PANIC, AND DON'T LET REKORDBOX "FIX" IT YET.

Your music files are NOT affected by anything this app does. Only the
library database was touched. Your audio, your artwork and your analysis
files (waveforms, beatgrids, hot cues) were never written to.

If rekordbox or a player offers to DELETE or REBUILD the device library,
say NO until you have tried the steps below. Saying yes erases the
playlists on this drive.


----------------------------------------------------------------
 WHERE YOUR BACKUPS ARE
----------------------------------------------------------------

This drive carries two independent copies of every backup, in two
different folders, so losing one folder does not lose your history:

  COPY 1 (primary):
      ${primaryVaultPath}

  COPY 2 (mirror):
      ${mirrorVaultPath}

Each backup lives in its own timestamped folder containing the original
database files plus a "backup.json" describing them (sizes and SHA-256
checksums, so you can tell a good copy from a damaged one).

The live database this app reads and writes is:

      ${databasePath}

Backups currently on this drive (newest first):
${backupList}


----------------------------------------------------------------
 FIX IT WITHOUT A COMPUTER SCIENCE DEGREE (2 minutes)
----------------------------------------------------------------

  1. Plug this drive into any computer.

  2. Open the primary backup folder:
         ${primaryVaultPath}

  3. Pick the newest timestamped folder from BEFORE things broke.
     Folder names are UTC timestamps, so the biggest name is newest.

  4. Copy "export.pdb" out of that folder.
     If the folder also has "exportExt.pdb", copy that too.

  5. Paste both files into:
         ${databasePath}
     ...replacing the files already there. Say yes to overwrite.

  6. EJECT THE DRIVE PROPERLY. Do not just yank it out.
     (macOS: eject in Finder. Windows: "Safely Remove Hardware".)

  7. Plug it into your player. Your library is back.

If the primary folder is missing or looks damaged, repeat using COPY 2
at ${mirrorVaultPath} — it holds the same snapshots.


----------------------------------------------------------------
 THE EASIER WAY: LET THE APP DO IT
----------------------------------------------------------------

  1. Open ${APP_URL} in Chrome, Edge or Opera on a desktop computer.
     (Safari and iPhones cannot write to drives — reading only.)

  2. Select this USB drive when asked.

  3. Open Settings -> "Backups & Recovery".

  4. Pick a backup and press "Restore".
     The app checks every file's checksum before restoring, and it
     snapshots the drive's current state first, so restoring is itself
     undoable.

There is also a "Rescue" mode on that screen for when the library will
not load at all. It scans the whole drive for any recoverable database
and offers to put it back.


----------------------------------------------------------------
 IF THERE ARE NO BACKUPS ON THIS DRIVE
----------------------------------------------------------------

You can always rebuild the library from rekordbox itself:

  1. Plug the drive into a computer running rekordbox.
  2. Switch to Export mode.
  3. Select the device in the left sidebar.
  4. Re-export your playlists to the device.

This rewrites the database from your rekordbox collection. Your audio
files on the drive stay where they are; rekordbox will reuse them.


----------------------------------------------------------------
 GIG-NIGHT TRIAGE
----------------------------------------------------------------

  Player says "Device Library is corrupted"
      -> Restore a backup (above). Do NOT accept the player's offer to
         delete the library if you have not backed up first.

  Player shows tracks but no playlists
      -> The playlist tables are damaged. Restore a backup.

  Player shows no waveform / no beatgrid / no hot cues
      -> That is analysis data, not the database. Re-export from
         rekordbox, or re-analyse the tracks.

  Newer gear (OPUS-QUAD, OMNIS-DUO, XDJ-AZ, CDJ-3000X) says
  "Device Library Plus not found"
      -> That hardware needs the newer library format, which this app
         does not write. Plug the drive into rekordbox 6.6.11 or newer
         and let it convert the device library. Your playlists carry
         over.

  Nothing works and you are on in ten minutes
      -> Use a different drive exported from rekordbox. Sort this one
         out tomorrow. The backups here are not going anywhere.


----------------------------------------------------------------
 ABOUT THIS FILE
----------------------------------------------------------------

${APP_NAME} rewrites this note every time it writes to the drive, so
the backup list above is current as of the timestamp at the top.

It is safe to delete this file. It is safer to leave it.

================================================================
`;
}

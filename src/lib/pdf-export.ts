import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Track } from '@/types/rekordbox';
import { formatDuration, formatBpm } from '@/lib/rekordbox-parser';

export function exportTracksToPdf(tracks: Track[], playlistName: string) {
  const doc = new jsPDF();
  
  // Title
  doc.setFontSize(18);
  doc.text(playlistName, 14, 22);
  
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Total Tracks: ${tracks.length}`, 14, 30);
  
  const tableColumn = ["Title", "Artist", "Album", "Genre", "BPM", "Key", "Duration"];
  const tableRows: string[][] = [];

  tracks.forEach(track => {
    const trackData = [
      track.title || "Unknown",
      track.artist || "Unknown",
      track.album || "",
      track.genre || "",
      formatBpm(track.bpm),
      track.key || "",
      formatDuration(track.duration)
    ];
    tableRows.push(trackData);
  });

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: 35,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 128, 185] },
  });

  doc.save(`${playlistName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
}

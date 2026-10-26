import { Track } from '@/types/rekordbox';
import { formatDuration, formatBpm } from '@/lib/rekordbox-parser';

export async function exportTracksToPdf(tracks: Track[], playlistName: string, hiddenColumns: string[] = []) {
  // jsPDF and autotable are a large chunk that most sessions never use, so they load on
  // the first export rather than with the app. autoTable is called as a function, which
  // needs no applyPlugin() — that is only for the doc.autoTable() form.
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

  const doc = new jsPDF();
  
  // Title
  doc.setFontSize(18);
  doc.text(playlistName, 14, 22);
  
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Total Tracks: ${tracks.length}`, 14, 30);
  
  const allColumns = [
    { key: 'title', title: "Title" },
    { key: 'artist', title: "Artist" },
    { key: 'album', title: "Album" },
    { key: 'genre', title: "Genre" },
    { key: 'bpm', title: "BPM" },
    { key: 'key', title: "Key" },
    { key: 'label', title: "Label" },
    { key: 'year', title: "Year" },
    { key: 'duration', title: "Duration" }
  ];

  // Filter columns
  // Title, Artist, Album are mandatory
  const mandatoryKeys = ['title', 'artist', 'album'];
  const visibleColumns = allColumns.filter(col => 
    mandatoryKeys.includes(col.key) || !hiddenColumns.includes(col.key)
  );

  const tableColumn = visibleColumns.map(col => col.title);
  const tableRows: string[][] = [];

  tracks.forEach(track => {
    const rowData: string[] = [];
    visibleColumns.forEach(col => {
      switch (col.key) {
        case 'title':
          rowData.push(track.title || "Unknown");
          break;
        case 'artist':
          rowData.push(track.artist || "Unknown");
          break;
        case 'album':
          rowData.push(track.album || "");
          break;
        case 'genre':
          rowData.push(track.genre || "");
          break;
        case 'bpm':
          rowData.push(formatBpm(track.bpm));
          break;
        case 'key':
          rowData.push(track.key || "");
          break;
        case 'label':
          rowData.push(track.label || "");
          break;
        case 'year':
          rowData.push(track.year ? track.year.toString() : "");
          break;
        case 'duration':
          rowData.push(formatDuration(track.duration));
          break;
      }
    });
    tableRows.push(rowData);
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

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deletingDrawing) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.kind === "sheet" ? "Remove sheet from analysis" : "Remove drawing"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "sheet"
                ? `Remove "${deleteTarget.label || "this sheet"}" from this project's Code Analyzer drawing set? Related findings for that sheet will be removed or invalidated. The original PDF is kept unless you remove the whole drawing.`
                : `Delete "${deleteTarget?.label || "this drawing"}" from this project? This cannot be undone. Related Code Analyzer findings for this drawing will also be removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingDrawing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingDrawing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault();
                const target = deleteTarget;
                if (!target || !selectedProjectId) {
                  setDeleteTarget(null);
                  return;
                }
                setDeletingDrawing(true);
                try {
                  if (target.kind === "sheet" && target.sheet) {
                    const sheet = target.sheet;
                    const source = sheetDocuments.find((d) => d.id === sheet.source_document_id) ?? null;
                    const image = sheet.image_document_id
                      ? sheetDocuments.find((d) => d.id === sheet.image_document_id) ?? null
                      : source;
                    const ok = await deleteAnalyzerSheet({
                      sheet,
                      sourceDocument: source,
                      imageDocument: image,
                      deleteDocument,
                      deleteSheetRow: deleteAnalyzerSheetRow,
                    });
                    if (!ok) return;
                  } else {
                    const source =
                      sheetDocuments.find((d) => d.id === target.sourceDocumentId) ??
                      documentsWithAnalysis.find((d) => d.id === target.sourceDocumentId);
                    if (!source) {
                      toast.error("Could not find that drawing to delete");
                      setDeleteTarget(null);
                      return;
                    }
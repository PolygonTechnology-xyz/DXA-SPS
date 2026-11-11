import { unlinkSync } from "fs";
import { join, extname } from "path";
import { db } from "../db/index";
import { json, cors } from "../utils/cors";
import { nanoid } from "../utils/id";
import { ingestFile, removeFileData, getPages, renderPage, sheetGrid } from "../services/ingest";
import { DATA_DIR } from "../config";
import { log } from "../utils/log";

const FILE_COLUMNS = "id, project_id, name, size, created_at, kind, pages, status, status_note";

export async function handleFiles(req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase();

  const filesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
  if (filesMatch) {
    const projectId = filesMatch[1];
    if (method === "GET") {
      const rows = db.query(`SELECT ${FILE_COLUMNS} FROM files WHERE project_id = ? ORDER BY created_at DESC`).all(projectId);
      return json(rows);
    }
    if (method === "POST") {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return json({ error: "no_file" }, 400);
      const id = `file_${nanoid()}`;
      const dest = join(DATA_DIR, `${id}_${file.name}`);
      await Bun.write(dest, file);
      db.query(
        "INSERT INTO files (id, project_id, name, size, path, content, status, status_note) VALUES (?, ?, ?, ?, ?, '', 'processing', 'Reading the document…')"
      ).run(id, projectId, file.name, file.size, dest);
      // Conversion and indexing run in the background; the file list shows the status
      ingestFile(id).catch((err) => log.error(`ingest ${file.name}: ${String(err)}`));
      return json(db.query(`SELECT ${FILE_COLUMNS} FROM files WHERE id = ?`).get(id), 201);
    }
  }

  // Reference popup: the text of one cited page (and its image, for scanned pages)
  const pageMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/([^/]+)\/pages\/(\d+)(\/image)?$/);
  if (method === "GET" && pageMatch) {
    const [, , fileId, pageStr, image] = pageMatch;
    const row = db.query("SELECT name, kind, pages, path, pdf_path FROM files WHERE id = ?").get(fileId) as { name: string; kind: string | null; pages: number; path: string; pdf_path: string | null } | null;
    if (!row) return json({ error: "not_found" }, 404);
    const page = Math.max(1, Math.min(Number(pageStr), row.pages || 1));
    if (image) {
      const png = row.kind === "pdf" && row.pdf_path ? await renderPage(row.pdf_path, page) : null;
      if (!png) return json({ error: "no_image" }, 404);
      return new Response(png as unknown as BodyInit, { headers: cors(new Headers({ "Content-Type": "image/png", "Cache-Control": "max-age=3600" })) });
    }
    const p = getPages(fileId, page, page)[0];
    return json({ name: row.name, kind: row.kind, page, pages: row.pages || 1, text: p?.text ?? "", quality: p?.quality ?? "empty" });
  }

  // Reference popup: a spreadsheet shown as it is (sheets, cells, merged cells)
  const sheetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/([^/]+)\/sheet$/);
  if (method === "GET" && sheetMatch) {
    const row = db.query("SELECT name, path FROM files WHERE id = ?").get(sheetMatch[2]) as { name: string; path: string } | null;
    if (!row) return json({ error: "not_found" }, 404);
    if (!/\.(xlsx|xlsm|xls|ods|csv)$/i.test(row.name)) return json({ error: "not_a_spreadsheet" }, 400);
    try {
      return json({ name: row.name, sheets: await sheetGrid(sheetMatch[2], row.path) });
    } catch (err) {
      log.error(`sheet ${row.name}: ${String(err)}`);
      return json({ error: "The spreadsheet could not be opened." }, 500);
    }
  }

  const fileActionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/([^/]+)(?:\/(download|view|retry))?$/);
  if (fileActionMatch) {
    const [, , fileId, action] = fileActionMatch;
    const row = db.query("SELECT * FROM files WHERE id = ?").get(fileId) as Record<string, unknown> | null;
    if (!row) return json({ error: "not_found" }, 404);

    // process a failed file again (Retry button)
    if (method === "POST" && action === "retry") {
      ingestFile(fileId).catch((err) => log.error(`retry ${row.name}: ${String(err)}`));
      return json(db.query(`SELECT ${FILE_COLUMNS} FROM files WHERE id = ?`).get(fileId));
    }

    if (method === "GET" && action === "download") {
      const filePath = row.path as string;
      const file = Bun.file(filePath);
      return new Response(file, {
        headers: cors(new Headers({
          "Content-Disposition": `attachment; filename="${row.name}"`,
          "Content-Type": file.type || "application/octet-stream",
        })),
      });
    }

    // Opens in the browser — the copy the AI read (an office file's converted PDF, an image's
    // JPEG), so citation links like …/view#page=4 land on the cited page
    if (method === "GET" && action === "view") {
      const filePath = (row.pdf_path as string | null) ?? (row.path as string);
      const file = Bun.file(filePath);
      const name = row.pdf_path && row.pdf_path !== row.path ? `${String(row.name).replace(/\.[^.]+$/, "")}${extname(String(row.pdf_path))}` : String(row.name);
      return new Response(file, {
        headers: cors(new Headers({
          "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
          "Content-Type": file.type || "application/octet-stream",
        })),
      });
    }

    if (method === "DELETE") {
      try { unlinkSync(row.path as string); } catch { /* file may already be gone */ }
      removeFileData(fileId);
      db.query("DELETE FROM files WHERE id = ?").run(fileId);
      return json({ ok: true });
    }
  }

  return json({ error: "not_found" }, 404);
}

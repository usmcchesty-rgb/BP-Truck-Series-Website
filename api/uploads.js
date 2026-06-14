import { uploadDriverPhoto } from "./_upload-driver-photo.js";
import { uploadHeaderLogo } from "./_upload-header-logo.js";
import { uploadReporterImage } from "./_upload-reporter-image.js";
import { uploadNewsArticleImage } from "./_upload-news-article-image.js";

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function resolveAction(body) {
  return String(body.action || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = parseBody(req);
    const password = process.env.ADMIN_PASSWORD;
    if (password && body.password !== password) {
      json(res, 401, { error: "Invalid admin password." });
      return;
    }

    const action = resolveAction(body);
    if (!action) {
      json(res, 400, { error: 'Missing action. Use "driver-photo", "header-logo", "reporter-image", or "news-article-image".' });
      return;
    }

    let result;
    if (action === "driver-photo") {
      result = await uploadDriverPhoto(body);
    } else if (action === "header-logo") {
      result = await uploadHeaderLogo(body);
    } else if (action === "reporter-image") {
      result = await uploadReporterImage(body);
    } else if (action === "news-article-image") {
      result = await uploadNewsArticleImage(body);
    } else {
      json(res, 400, { error: `Unknown action: ${action}` });
      return;
    }

    json(res, 200, { success: true, ...result });
  } catch (err) {
    if (err.details?.setupSql) {
      json(res, err.status || 400, {
        error: err.details.error || err.message || "Save failed.",
        bucket: err.details.bucket,
        setupSql: err.details.setupSql,
      });
      return;
    }
    json(res, err.status || 400, { error: err.message || "Save failed." });
  }
}

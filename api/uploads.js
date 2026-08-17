import { uploadDriverPhoto, removeDriverPhoto } from "./_upload-driver-photo.js";
import {
  uploadStandingDriverPhoto,
  removeStandingDriverPhoto,
} from "./_upload-standing-driver-photo.js";
import { uploadHeaderLogo } from "./_upload-header-logo.js";
import { uploadReporterImage } from "./_upload-reporter-image.js";
import { uploadNewsArticleImage } from "./_upload-news-article-image.js";
import {
  uploadPowerRankingsFormulaImage,
  removePowerRankingsFormulaImage,
} from "./_upload-power-rankings-formula-image.js";
import {
  uploadSpotlightImage,
  removeSpotlightImage,
} from "./_upload-spotlight-image.js";
import {
  uploadFantasyHeroBackgroundImage,
  removeFantasyHeroBackgroundImage,
  uploadFantasyHeaderLogoImage,
  removeFantasyHeaderLogoImage,
} from "./_upload-fantasy-branding.js";
import { uploadSocialShareIcon } from "./_upload-social-share-icon.js";
import {
  previewDriverNumberArtwork,
  removeDriverNumberArtwork,
  uploadDriverNumberArtwork,
} from "./_upload-driver-number-artwork.js";

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
      json(res, 400, { error: 'Missing action. Use "driver-photo", "remove-driver-photo", "standing-driver-photo", "remove-standing-driver-photo", "header-logo", "reporter-image", "news-article-image", "power-rankings-formula-image", "remove-power-rankings-formula-image", "spotlight-image", "remove-spotlight-image", "fantasy-hero-background-image", "remove-fantasy-hero-background-image", "fantasy-header-logo-image", "remove-fantasy-header-logo-image", "social-share-icon", "driver-number-artwork", "remove-driver-number-artwork", or "preview-driver-number-artwork".' });
      return;
    }

    let result;
    if (action === "driver-photo") {
      result = await uploadDriverPhoto(body);
    } else if (action === "remove-driver-photo") {
      result = await removeDriverPhoto(body);
    } else if (action === "standing-driver-photo") {
      result = await uploadStandingDriverPhoto(body);
    } else if (action === "remove-standing-driver-photo") {
      result = await removeStandingDriverPhoto(body);
    } else if (action === "header-logo") {
      result = await uploadHeaderLogo(body);
    } else if (action === "reporter-image") {
      result = await uploadReporterImage(body);
    } else if (action === "news-article-image") {
      result = await uploadNewsArticleImage(body);
    } else if (action === "power-rankings-formula-image") {
      result = await uploadPowerRankingsFormulaImage(body);
    } else if (action === "remove-power-rankings-formula-image") {
      result = await removePowerRankingsFormulaImage(body);
    } else if (action === "spotlight-image") {
      result = await uploadSpotlightImage(body);
    } else if (action === "remove-spotlight-image") {
      result = await removeSpotlightImage(body);
    } else if (action === "fantasy-hero-background-image") {
      result = await uploadFantasyHeroBackgroundImage(body);
    } else if (action === "remove-fantasy-hero-background-image") {
      result = await removeFantasyHeroBackgroundImage(body);
    } else if (action === "fantasy-header-logo-image") {
      result = await uploadFantasyHeaderLogoImage(body);
    } else if (action === "remove-fantasy-header-logo-image") {
      result = await removeFantasyHeaderLogoImage(body);
    } else if (action === "social-share-icon") {
      result = await uploadSocialShareIcon(body);
    } else if (action === "driver-number-artwork") {
      result = await uploadDriverNumberArtwork(body);
    } else if (action === "remove-driver-number-artwork") {
      result = await removeDriverNumberArtwork(body);
    } else if (action === "preview-driver-number-artwork") {
      result = await previewDriverNumberArtwork(body);
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

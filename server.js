// src/server.js — Hovedserver
require("dotenv").config();
const express = require("express");
const path = require("path");
const { verifyWebhook, handleOrderPaid, handleOrderRestore, handleProductUpdate } = require("./webhooks");
const { getProducts, registerWebhooks } = require("./shopify");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Raw body til webhook-verificering
app.use("/webhooks", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ─── WEBHOOKS ────────────────────────────────────────────────────────────────

app.post("/webhooks/orders/paid", async (req, res) => {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!verifyWebhook(req.body, hmac)) return res.status(401).send("Uautoriseret");
  res.sendStatus(200); // Svar hurtigt til Shopify
  try { await handleOrderPaid(JSON.parse(req.body)); } catch (e) { console.error(e); }
});

app.post("/webhooks/orders/cancelled", async (req, res) => {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!verifyWebhook(req.body, hmac)) return res.status(401).send("Uautoriseret");
  res.sendStatus(200);
  try { await handleOrderRestore(JSON.parse(req.body), "cancelled"); } catch (e) { console.error(e); }
});

app.post("/webhooks/refunds/create", async (req, res) => {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!verifyWebhook(req.body, hmac)) return res.status(401).send("Uautoriseret");
  res.sendStatus(200);
  try { await handleOrderRestore(JSON.parse(req.body), "refund"); } catch (e) { console.error(e); }
});

app.post("/webhooks/products/update", async (req, res) => {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!verifyWebhook(req.body, hmac)) return res.status(401).send("Uautoriseret");
  res.sendStatus(200);
  try { await handleProductUpdate(JSON.parse(req.body)); } catch (e) { console.error(e); }
});

// ─── ADMIN API ────────────────────────────────────────────────────────────────

// Hent alle produkter fra Shopify (til dropdown i admin-UI)
app.get("/api/products", async (req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Hent alle koblinger
app.get("/api/mappings", (req, res) => {
  res.json(db.getAllMappings());
});

// Hent koblinger for én kit-variant
app.get("/api/mappings/:kitVariantId", (req, res) => {
  res.json(db.getMappings(req.params.kitVariantId));
});

// Opret kobling
app.post("/api/mappings", (req, res) => {
  const { kitVariantId, kitTitle, yarnVariantId, yarnTitle, quantity } = req.body;
  if (!kitVariantId || !yarnVariantId || !quantity) {
    return res.status(400).json({ error: "Mangler felter" });
  }
  db.upsertMapping(kitVariantId, kitTitle, yarnVariantId, yarnTitle, Number(quantity));
  res.json({ ok: true });
});

// Slet kobling
app.delete("/api/mappings/:id", (req, res) => {
  db.deleteMapping(req.params.id);
  res.json({ ok: true });
});

// Hent ordre-log
app.get("/api/log", (req, res) => {
  res.json(db.getLog());
});

// Setup: registrer webhooks i Shopify
app.post("/api/setup", async (req, res) => {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return res.status(400).json({ error: "APP_URL ikke sat i .env" });
  try {
    await registerWebhooks(appUrl);
    res.json({ ok: true, message: "Webhooks registreret!" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🧶 Strikkekit App kører på port ${PORT}`);
  console.log(`📊 Admin-panel: http://localhost:${PORT}\n`);
});

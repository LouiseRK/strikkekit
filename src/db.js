// src/db.js — SQLite database til kit-koblinger
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "../knit-kit.db"));

// Opret tabeller hvis de ikke findes
db.exec(`
  CREATE TABLE IF NOT EXISTS kit_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kit_variant_id TEXT NOT NULL,        -- Shopify variant ID på kittet
    kit_title TEXT,                       -- Fx "Hygge Sweater Kit - M / Nordisk blå"
    yarn_variant_id TEXT NOT NULL,        -- Shopify variant ID på garnet
    yarn_title TEXT,                      -- Fx "Merino Wool DK - Ash Grey"
    quantity INTEGER NOT NULL DEFAULT 1,  -- Antal nøgler der bruges
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS kit_prices (
    kit_variant_id TEXT PRIMARY KEY,
    price TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shopify_order_id TEXT NOT NULL,
    action TEXT NOT NULL,                 -- 'deduct' eller 'restore'
    kit_variant_id TEXT NOT NULL,
    yarn_variant_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = {
  // Hent alle garn-koblinger for en kit-variant
  getMappings: (kitVariantId) => {
    return db.prepare(
      "SELECT * FROM kit_mappings WHERE kit_variant_id = ?"
    ).all(kitVariantId);
  },

  // Opret eller opdater en kobling
  upsertMapping: (kitVariantId, kitTitle, yarnVariantId, yarnTitle, quantity) => {
    db.prepare(`
      INSERT INTO kit_mappings (kit_variant_id, kit_title, yarn_variant_id, yarn_title, quantity)
      VALUES (?, ?, ?, ?, ?)
    `).run(kitVariantId, kitTitle, yarnVariantId, yarnTitle, quantity);
  },

  // Slet en kobling
  deleteMapping: (id) => {
    db.prepare("DELETE FROM kit_mappings WHERE id = ?").run(id);
  },

  // Hent alle koblinger (til admin-oversigt)
  getAllMappings: () => {
    return db.prepare(
      "SELECT * FROM kit_mappings ORDER BY kit_title, yarn_title"
    ).all();
  },

  // Hent alle kits der bruger en bestemt garn-variant (til price sync)
  getKitsByYarnVariant: (yarnVariantId) => {
    return db.prepare(
      "SELECT * FROM kit_mappings WHERE yarn_variant_id = ?"
    ).all(yarnVariantId);
  },

  // Gem seneste beregnede pris på et kit (til reference)
  updateKitPrice: (kitVariantId, price) => {
    db.prepare(`
      INSERT INTO kit_prices (kit_variant_id, price, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(kit_variant_id) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at
    `).run(kitVariantId, price);
  },
  logAction: (orderId, action, kitVariantId, yarnVariantId, quantity) => {
    db.prepare(`
      INSERT INTO order_log (shopify_order_id, action, kit_variant_id, yarn_variant_id, quantity)
      VALUES (?, ?, ?, ?, ?)
    `).run(orderId, action, kitVariantId, yarnVariantId, quantity);
  },

  // Tjek om en ordre allerede er behandlet
  orderProcessed: (orderId, action) => {
    return db.prepare(
      "SELECT id FROM order_log WHERE shopify_order_id = ? AND action = ? LIMIT 1"
    ).get(orderId, action);
  },

  // Hent seneste 100 log-entries
  getLog: () => {
    return db.prepare(
      "SELECT * FROM order_log ORDER BY processed_at DESC LIMIT 100"
    ).all();
  },
};

// src/shopify.js — Shopify Admin API kald
const fetch = require("node-fetch");

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;       // fx "minbutik.myshopify.com"
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // Admin API access token

const shopifyFetch = async (endpoint, options = {}) => {
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-01/${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API fejl ${res.status}: ${text}`);
  }
  return res.json();
};

// Hent alle produkter fra butikken (til admin-UI)
const getProducts = async () => {
  const data = await shopifyFetch("products.json?limit=250&fields=id,title,variants");
  return data.products;
};

// Hent nuværende lagerniveau for en variant
const getInventoryLevel = async (inventoryItemId, locationId) => {
  const data = await shopifyFetch(
    `inventory_levels.json?inventory_item_ids=${inventoryItemId}&location_ids=${locationId}`
  );
  return data.inventory_levels[0];
};

// Juster lager (positiv = tilføj, negativ = træk fra)
const adjustInventory = async (inventoryItemId, locationId, adjustment) => {
  return shopifyFetch("inventory_levels/adjust.json", {
    method: "POST",
    body: JSON.stringify({
      inventory_item_id: inventoryItemId,
      location_id: locationId,
      available_adjustment: adjustment,
    }),
  });
};

// Hent variant-info inkl. inventory_item_id
const getVariant = async (variantId) => {
  const data = await shopifyFetch(`variants/${variantId}.json`);
  return data.variant;
};

// Hent butikkens primære lokation
const getPrimaryLocation = async () => {
  const data = await shopifyFetch("locations.json");
  return data.locations[0];
};

// Opdater prisen på en variant
const updateVariantPrice = async (variantId, price) => {
  return shopifyFetch(`variants/${variantId}.json`, {
    method: "PUT",
    body: JSON.stringify({ variant: { id: variantId, price } }),
  });
};

// Registrer webhooks i Shopify (køres én gang ved setup)
const registerWebhooks = async (appUrl) => {
  const webhooks = [
    { topic: "orders/paid",       address: `${appUrl}/webhooks/orders/paid` },
    { topic: "orders/cancelled",  address: `${appUrl}/webhooks/orders/cancelled` },
    { topic: "refunds/create",    address: `${appUrl}/webhooks/refunds/create` },
    { topic: "products/update",   address: `${appUrl}/webhooks/products/update` },
  ];

  for (const wh of webhooks) {
    try {
      await shopifyFetch("webhooks.json", {
        method: "POST",
        body: JSON.stringify({ webhook: { topic: wh.topic, address: wh.address, format: "json" } }),
      });
      console.log(`✅ Webhook registreret: ${wh.topic}`);
    } catch (err) {
      console.log(`⚠️  Webhook eksisterer muligvis allerede: ${wh.topic}`);
    }
  }
};

module.exports = { getProducts, adjustInventory, getVariant, getPrimaryLocation, updateVariantPrice, registerWebhooks };

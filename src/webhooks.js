// src/webhooks.js — Håndterer alle Shopify webhook events
const crypto = require("crypto");
const db = require("./db");
const { adjustInventory, getVariant, getPrimaryLocation, updateVariantPrice, getProductVariants } = require("./shopify");

// Verificer at webhook faktisk kommer fra Shopify
const verifyWebhook = (rawBody, hmacHeader) => {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hash = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  return hash === hmacHeader;
};

// Træk lager fra garn når et kit sælges
const handleOrderPaid = async (order) => {
  console.log(`📦 Ordre betalt: #${order.order_number}`);

  // Undgå dobbelt-behandling
  if (db.orderProcessed(String(order.id), "deduct")) {
    console.log(`⚠️  Ordre ${order.id} allerede behandlet — springer over`);
    return;
  }

  const location = await getPrimaryLocation();

  for (const lineItem of order.line_items) {
    const kitVariantId = String(lineItem.variant_id);
    const kitQuantity = lineItem.quantity;
    const mappings = db.getMappings(kitVariantId);

    if (mappings.length === 0) {
      console.log(`ℹ️  Variant ${kitVariantId} er ikke et kit — ingen lagertræk`);
      continue;
    }

    console.log(`🧶 Kit solgt: ${lineItem.title} × ${kitQuantity}`);

    for (const mapping of mappings) {
      const adjustment = -(mapping.quantity * kitQuantity);
      try {
        const yarnVariant = await getVariant(mapping.yarn_variant_id);
        await adjustInventory(
          yarnVariant.inventory_item_id,
          location.id,
          adjustment
        );
        db.logAction(String(order.id), "deduct", kitVariantId, mapping.yarn_variant_id, mapping.quantity * kitQuantity);
        console.log(`  ✅ ${mapping.yarn_title}: ${adjustment} stk`);
      } catch (err) {
        console.error(`  ❌ Fejl på ${mapping.yarn_title}:`, err.message);
      }
    }
  }
};

// Sæt lager tilbage ved annullering eller refundering
const handleOrderRestore = async (order, action) => {
  console.log(`↩️  Ordre ${action}: #${order.order_number || order.id}`);

  if (db.orderProcessed(String(order.id), "restore")) {
    console.log(`⚠️  Ordre ${order.id} allerede gendannet — springer over`);
    return;
  }

  const location = await getPrimaryLocation();
  const lineItems = order.line_items || order.refund_line_items?.map(r => ({
    ...r.line_item,
    quantity: r.quantity,
  })) || [];

  for (const lineItem of lineItems) {
    const kitVariantId = String(lineItem.variant_id);
    const kitQuantity = lineItem.quantity;
    const mappings = db.getMappings(kitVariantId);

    if (mappings.length === 0) continue;

    console.log(`🧶 Kit gendannes: ${lineItem.title} × ${kitQuantity}`);

    for (const mapping of mappings) {
      const adjustment = mapping.quantity * kitQuantity;
      try {
        const yarnVariant = await getVariant(mapping.yarn_variant_id);
        await adjustInventory(
          yarnVariant.inventory_item_id,
          location.id,
          adjustment
        );
        db.logAction(String(order.id), "restore", kitVariantId, mapping.yarn_variant_id, mapping.quantity * kitQuantity);
        console.log(`  ✅ ${mapping.yarn_title}: +${adjustment} stk`);
      } catch (err) {
        console.error(`  ❌ Fejl på ${mapping.yarn_title}:`, err.message);
      }
    }
  }
};

// Opdater kit-priser når et garn-produkt ændres
const handleProductUpdate = async (product) => {
  console.log(`💰 Produkt opdateret: ${product.title}`);

  // Find alle varianter på dette produkt
  for (const variant of product.variants) {
    const yarnVariantId = String(variant.id);

    // Find alle kits der bruger denne garn-variant
    const affectedKits = db.getKitsByYarnVariant(yarnVariantId);
    if (affectedKits.length === 0) continue;

    console.log(`  🧶 ${affectedKits.length} kits påvirket af prisændring på ${variant.title}`);

    // Opdater prisen på hvert berørt kit
    const updatedKits = new Set();
    for (const kitMapping of affectedKits) {
      if (updatedKits.has(kitMapping.kit_variant_id)) continue;

      const allMappings = db.getMappings(kitMapping.kit_variant_id);
      let totalPrice = 0;

      for (const mapping of allMappings) {
        const yarnVariant = await getVariant(mapping.yarn_variant_id);
        totalPrice += parseFloat(yarnVariant.price) * mapping.quantity;
      }

      // Afrund til nærmeste hele krone
      const newPrice = Math.ceil(totalPrice).toFixed(2);

      try {
        await updateVariantPrice(kitMapping.kit_variant_id, newPrice);
        db.updateKitPrice(kitMapping.kit_variant_id, newPrice);
        console.log(`  ✅ Kit variant ${kitMapping.kit_variant_id} → ${newPrice} kr`);
        updatedKits.add(kitMapping.kit_variant_id);
      } catch (err) {
        console.error(`  ❌ Kunne ikke opdatere pris:`, err.message);
      }
    }
  }
};

module.exports = { verifyWebhook, handleOrderPaid, handleOrderRestore, handleProductUpdate };

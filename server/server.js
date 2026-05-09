require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { RouterOSAPI } = require("node-routeros");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ============================================
// STOCKAGE EN MÉMOIRE DES TRANSACTIONS
// (En production, utiliser une base de données)
// ============================================
const transactions = new Map();

// ============================================
// PLANS WIFI - correspondance avec Mikrotik
// ============================================
const PLANS = {
  "30min":     { profile: "wifi-30min",   duration: "00:30:00", speed: "2M/2M" },
  "1h":        { profile: "wifi-1h",      duration: "01:00:00", speed: "5M/3M" },
  "3h":        { profile: "wifi-3h",      duration: "03:00:00", speed: "5M/3M" },
  "1jour":     { profile: "wifi-1jour",   duration: "1d 00:00:00", speed: "10M/5M" },
  "1semaine":  { profile: "wifi-1semaine", duration: "7d 00:00:00", speed: "10M/5M" },
  "1mois":     { profile: "wifi-1mois",   duration: "30d 00:00:00", speed: "15M/10M" },
};

// ============================================
// CONNEXION MIKROTIK
// ============================================
async function getMikrotikConnection() {
  const conn = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST,
    port: parseInt(process.env.MIKROTIK_PORT) || 8728,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASSWORD,
    timeout: 10,
  });
  await conn.connect();
  return conn;
}

// ============================================
// CRÉER UN UTILISATEUR HOTSPOT SUR MIKROTIK
// ============================================
async function createHotspotUser(reference, planId) {
  const plan = PLANS[planId];
  if (!plan) {
    console.error("Plan inconnu:", planId);
    return false;
  }

  let conn;
  try {
    conn = await getMikrotikConnection();

    // Créer le user profile s'il n'existe pas
    const profiles = await conn.write("/ip/hotspot/user/profile/print", [
      "?name=" + plan.profile,
    ]);

    if (profiles.length === 0) {
      await conn.write("/ip/hotspot/user/profile/add", [
        "=name=" + plan.profile,
        "=rate-limit=" + plan.speed,
        "=session-timeout=" + plan.duration,
        "=shared-users=1",
      ]);
      console.log("Profile créé:", plan.profile);
    }

    // Créer l'utilisateur hotspot
    const username = "wifi_" + reference;
    const password = reference;

    await conn.write("/ip/hotspot/user/add", [
      "=name=" + username,
      "=password=" + password,
      "=profile=" + plan.profile,
      "=limit-uptime=" + plan.duration,
      "=comment=FreeMoPay:" + reference,
    ]);

    console.log("User hotspot créé:", username, "| Plan:", plan.profile);
    return true;
  } catch (err) {
    console.error("Erreur Mikrotik:", err.message);
    return false;
  } finally {
    if (conn) {
      try { conn.close(); } catch (e) {}
    }
  }
}

// ============================================
// ROUTE: Initier un paiement (appelé par la page captive)
// ============================================
app.post("/api/payment/init", async (req, res) => {
  const { phone, amount, planId, macAddress, ipAddress } = req.body;

  if (!phone || !amount || !planId) {
    return res.status(400).json({ error: "Champs requis: phone, amount, planId" });
  }

  const externalId = "INSAM-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 8);
  const callbackUrl = req.protocol + "://" + req.get("host") + "/api/webhook/freemopay";

  // Appel FreeMoPay v2
  try {
    const credentials = Buffer.from(
      process.env.FREEMOPAY_APP_KEY + ":" + process.env.FREEMOPAY_SECRET_KEY
    ).toString("base64");

    const response = await fetch(process.env.FREEMOPAY_BASE_URL + "/api/v2/payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + credentials,
      },
      body: JSON.stringify({
        phone: phone,
        amount: amount,
        externalId: externalId,
        callback: callbackUrl,
      }),
    });

    const data = await response.json();

    if (data.reference) {
      // Stocker la transaction
      transactions.set(data.reference, {
        reference: data.reference,
        externalId: externalId,
        planId: planId,
        phone: phone,
        amount: amount,
        macAddress: macAddress || "",
        ipAddress: ipAddress || "",
        status: "PENDING",
        createdAt: new Date(),
      });

      console.log("Paiement initié:", data.reference, "| Plan:", planId, "| Montant:", amount);
      return res.json({ reference: data.reference, status: "PENDING" });
    } else {
      return res.status(400).json({ error: data.message || "Erreur FreeMoPay" });
    }
  } catch (err) {
    console.error("Erreur appel FreeMoPay:", err.message);
    return res.status(500).json({ error: "Erreur de connexion à FreeMoPay" });
  }
});

// ============================================
// ROUTE: Webhook callback FreeMoPay
// ============================================
app.post("/api/webhook/freemopay", async (req, res) => {
  const { status, reference, amount, externalId, message } = req.body;

  console.log("Webhook FreeMoPay reçu:", { status, reference, externalId, amount });

  const transaction = transactions.get(reference);
  if (!transaction) {
    console.warn("Transaction inconnue:", reference);
    return res.status(200).json({ received: true });
  }

  transaction.status = status;

  if (status === "SUCCESS") {
    // Créer l'utilisateur sur le Mikrotik
    const created = await createHotspotUser(reference, transaction.planId);
    transaction.mikrotikCreated = created;
    console.log("Paiement SUCCESS:", reference, "| Mikrotik user créé:", created);
  } else {
    console.log("Paiement FAILED:", reference, "| Message:", message);
  }

  res.status(200).json({ received: true });
});

// ============================================
// ROUTE: Vérifier le statut d'un paiement
// (appelé par la page captive en polling)
// ============================================
app.get("/api/payment/status/:reference", (req, res) => {
  const transaction = transactions.get(req.params.reference);

  if (!transaction) {
    return res.status(404).json({ status: "UNKNOWN", message: "Transaction introuvable" });
  }

  res.json({
    status: transaction.status,
    reference: transaction.reference,
    mikrotikReady: transaction.mikrotikCreated || false,
  });
});

// ============================================
// ROUTE: Santé du serveur
// ============================================
app.get("/api/health", async (req, res) => {
  let mikrotikOk = false;
  try {
    const conn = await getMikrotikConnection();
    await conn.write("/system/identity/print");
    conn.close();
    mikrotikOk = true;
  } catch (e) {}

  res.json({
    status: "ok",
    mikrotik: mikrotikOk ? "connected" : "disconnected",
    transactions: transactions.size,
    uptime: process.uptime(),
  });
});

// ============================================
// DÉMARRAGE
// ============================================
app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("  IUEs/INSAM WiFi Server");
  console.log("  Port:", PORT);
  console.log("  Mikrotik:", process.env.MIKROTIK_HOST);
  console.log("=".repeat(50));
});

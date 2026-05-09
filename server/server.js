require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MIKROTIK_SECRET = process.env.MIKROTIK_SECRET || "insam2026wifi";

// ============================================
// STOCKAGE EN MÉMOIRE DES TRANSACTIONS
// ============================================
const transactions = new Map();
// File d'attente des users à créer sur Mikrotik
const pendingUsers = [];

// ============================================
// PLANS WIFI - correspondance avec Mikrotik
// ============================================
const PLANS = {
  "30min":     { profile: "wifi-30min",    duration: "00:30:00", speed: "2M/2M" },
  "1h":        { profile: "wifi-1h",       duration: "01:00:00", speed: "5M/3M" },
  "3h":        { profile: "wifi-3h",       duration: "03:00:00", speed: "5M/3M" },
  "1jour":     { profile: "wifi-1jour",    duration: "1d 00:00:00", speed: "10M/5M" },
  "1semaine":  { profile: "wifi-1semaine", duration: "7d 00:00:00", speed: "10M/5M" },
  "1mois":     { profile: "wifi-1mois",    duration: "30d 00:00:00", speed: "15M/10M" },
};

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
      transactions.set(data.reference, {
        reference: data.reference,
        externalId: externalId,
        planId: planId,
        phone: phone,
        amount: amount,
        macAddress: macAddress || "",
        ipAddress: ipAddress || "",
        status: "PENDING",
        mikrotikCreated: false,
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
    const plan = PLANS[transaction.planId];
    if (plan) {
      // Ajouter à la file d'attente pour le Mikrotik
      pendingUsers.push({
        username: "wifi_" + reference,
        password: reference,
        profile: plan.profile,
        duration: plan.duration,
        speed: plan.speed,
        reference: reference,
        createdAt: new Date().toISOString(),
      });
      transaction.mikrotikCreated = true;
      console.log("Paiement SUCCESS:", reference, "| User ajouté à la file Mikrotik");
    }
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
// ROUTE: Mikrotik récupère les users à créer
// Le Mikrotik appelle cette URL toutes les 30s
// GET /api/mikrotik/pending-users?secret=insam2026wifi
// ============================================
app.get("/api/mikrotik/pending-users", (req, res) => {
  // Vérification du secret
  if (req.query.secret !== MIKROTIK_SECRET) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  // Renvoyer tous les users en attente
  const users = pendingUsers.splice(0, pendingUsers.length);

  res.json({
    count: users.length,
    users: users,
  });
});

// ============================================
// ROUTE: Santé du serveur
// ============================================
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    pendingUsers: pendingUsers.length,
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
  console.log("  Mode: Mikrotik polling");
  console.log("=".repeat(50));
});

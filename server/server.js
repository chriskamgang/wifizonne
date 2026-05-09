require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MIKROTIK_SECRET = process.env.MIKROTIK_SECRET || "insam2026wifi";
const DB_FILE = path.join(__dirname, "transactions.json");

// ============================================
// STOCKAGE PERSISTANT DES TRANSACTIONS
// ============================================
let transactions = new Map();
let pendingUsers = [];

// Charger les transactions sauvegardées
function loadData() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      transactions = new Map(data.transactions || []);
      pendingUsers = data.pendingUsers || [];
      console.log("Données chargées:", transactions.size, "transactions,", pendingUsers.length, "users en attente");
    }
  } catch (e) {
    console.error("Erreur chargement données:", e.message);
  }
}

// Sauvegarder les transactions
function saveData() {
  try {
    const data = {
      transactions: Array.from(transactions.entries()),
      pendingUsers: pendingUsers,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Erreur sauvegarde:", e.message);
  }
}

loadData();

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
// ROUTE: Initier un paiement
// ============================================
app.post("/api/payment/init", async (req, res) => {
  const { phone, amount, planId, macAddress, ipAddress } = req.body;

  if (!phone || !amount || !planId) {
    return res.status(400).json({ error: "Champs requis: phone, amount, planId" });
  }

  const formattedPhone = String(phone).startsWith("237") ? String(phone) : "237" + String(phone);
  const externalId = "INSAM-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 8);
  const callbackUrl = "https://wifizone.iues-insambot.com/api/webhook/freemopay";

  console.log("Paiement demandé - Tél:", formattedPhone, "| Montant:", amount);

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
        payer: formattedPhone,
        amount: String(amount),
        externalId: externalId,
        callback: callbackUrl,
      }),
    });

    const data = await response.json();
    console.log("FreeMoPay réponse:", JSON.stringify(data));

    if (data.reference) {
      transactions.set(data.reference, {
        reference: data.reference,
        externalId: externalId,
        planId: planId,
        phone: formattedPhone,
        amount: amount,
        macAddress: macAddress || "",
        ipAddress: ipAddress || "",
        status: "PENDING",
        mikrotikCreated: false,
        createdAt: new Date().toISOString(),
      });
      saveData();

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

  saveData();
  res.status(200).json({ received: true });
});

// ============================================
// ROUTE: Vérifier le statut d'un paiement
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
// ============================================
app.get("/api/mikrotik/pending-users", (req, res) => {
  if (req.query.secret !== MIKROTIK_SECRET) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const users = pendingUsers.splice(0, pendingUsers.length);
  if (users.length > 0) {
    saveData();
  }

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

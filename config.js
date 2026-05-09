// ============================================
// CONFIGURATION - IUEs/INSAM WiFi Zone
// Modifiable par l'administrateur
// ============================================

const WIFI_CONFIG = {
  // Nom de la zone WiFi
  zoneName: "IUEs/INSAM WiFi Zone",

  // Logo (chemin relatif)
  logo: "app_icon.png",

  // URL du serveur backend (sur ton Linode)
  serverUrl: "https://wifi.votre-domaine.com",

  // FreeMoPay API v2 Configuration (utilisé côté serveur, pas côté client)
  // Les clés sont dans le .env du serveur, pas ici
  freemopay: {
    methods: ["mtn_momo", "orange_money"],
  },

  // Forfaits WiFi (modifiables depuis le panel admin)
  plans: [
    {
      id: "30min",
      name: "30 Minutes",
      duration: "30m",       // Format Mikrotik: 30m, 1h, 1d, etc.
      price: 100,
      currency: "XAF",
      speed: "2M/2M",       // Download/Upload Mikrotik
      description: "Navigation basique"
    },
    {
      id: "1h",
      name: "1 Heure",
      duration: "1h",
      price: 200,
      currency: "XAF",
      speed: "5M/3M",
      description: "Navigation confortable"
    },
    {
      id: "3h",
      name: "3 Heures",
      duration: "3h",
      price: 500,
      currency: "XAF",
      speed: "5M/3M",
      description: "Idéal pour les cours"
    },
    {
      id: "1jour",
      name: "1 Jour",
      duration: "1d",
      price: 1000,
      currency: "XAF",
      speed: "10M/5M",
      description: "Accès journalier complet"
    },
    {
      id: "1semaine",
      name: "1 Semaine",
      duration: "7d",
      price: 3000,
      currency: "XAF",
      speed: "10M/5M",
      description: "Accès hebdomadaire"
    },
    {
      id: "1mois",
      name: "1 Mois",
      duration: "30d",
      price: 10000,
      currency: "XAF",
      speed: "15M/10M",
      description: "Accès mensuel premium"
    }
  ],

  // Messages personnalisables
  messages: {
    welcome: "Bienvenue sur le réseau WiFi de l'IUEs/INSAM",
    subtitle: "Institut Universitaire et Stratégique de l'Estuaire",
    paymentSuccess: "Paiement réussi ! Vous êtes maintenant connecté.",
    paymentFailed: "Le paiement a échoué. Veuillez réessayer.",
    paymentPending: "Paiement en attente de confirmation...",
    footer: "© 2026 IUEs/INSAM - Tous droits réservés"
  }
};

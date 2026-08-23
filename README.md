# Dashboard Trade Republic

Tableau de bord auto-hébergé pour compte titre Trade Republic : performance du
portefeuille en temps réel, positions ouvertes, historique des positions soldées.
L'historique des transactions est lu **en direct** depuis un Google Sheet — rien
n'est stocké côté serveur.

- Graphique de performance (TWR) avec périodes 1 J / 1 S / 1 M / 6 M / 1 A / 3 A / Tout,
  filtrable par compte (tous / un seul / plusieurs) et plage de dates personnalisée ;
  une période sans assez d'historique pour le compte sélectionné n'est pas proposée
- Valeur temps réel des positions, espèces, P&L latent et réalisé, dividendes, frais
- **Une section par compte** : PEA, CTO, Cryptos — affichées uniquement si le compte
  existe et contient au moins une position ouverte
- Détail par position : PRU, performance, dernier achat, dernière vente, performance
  propre du titre sur 6 périodes avec mini-graphique
- Section Archives : positions entièrement soldées, classées par compte d'origine
- **Alertes de prix** : six seuils (au-dessus / en dessous du PRU, du dernier achat,
  de la dernière vente), une vérification par jour à l'heure de votre choix, fenêtre
  récapitulative dans l'app et notification push optionnelle sur téléphone et ordinateur
- PWA installable sur téléphone, mode clair/sombre, protégé par mot de passe
- Zéro dépendance npm (Node pur), déployable gratuitement sur Vercel

## Prérequis : l'historique des transactions

Un historique d'activité Trade Republic avec ces colonnes (format des outils
d'export TR usuels) :

```
datetime, date, account_type, category, type, asset_class, name, symbol,
shares, price, amount, fee, tax, currency, ...
```

`SHEET_URL` accepte trois formats, tous lus en direct sans rien stocker :

- **Google Sheet** : le lien de partage d'un Sheet contenant ces colonnes
  (`docs.google.com/spreadsheets/...`) ou son identifiant nu.
- **Fichier Google Drive** : le lien de partage d'un `.csv` brut déposé dans Drive
  (`drive.google.com/file/d/...` ou `.../open?id=...`) — pas besoin de l'importer
  dans un Sheet.
- **Fichier local** : le chemin d'un `.csv` sur le disque, pour essayer sans rien
  publier.

Dans les deux cas Google, le partage doit être réglé sur **« Tous les utilisateurs
disposant du lien »** (lecture seule). Le lien sert de configuration : personne
d'autre ne le connaît, ne le publiez nulle part.

Les colonnes `account_type` (DEFAULT, PEA…) et `asset_class` (STOCK, FUND, CRYPTO…)
déterminent les sections affichées ; il n'y a rien d'autre à configurer.

## Déployer votre instance (gratuit, ~10 min)

1. **Fork** : bouton « Fork » en haut de cette page GitHub (compte GitHub gratuit).
2. **Vercel** : créez un compte gratuit sur [vercel.com](https://vercel.com) (plan
   Hobby), « Add New… → Project », importez votre fork.
3. **Variables d'environnement** (dans l'écran d'import, section Environment
   Variables — ou plus tard via **Environment Variables** dans le menu de gauche
   du projet) :
   - `SHEET_URL` : le lien de partage de votre Google Sheet
   - `DASHBOARD_PASSWORD` : le mot de passe qui protégera votre dashboard
4. **Deploy**. Votre dashboard est sur `https://<votre-projet>.vercel.app`.
5. Sur téléphone : ouvrez l'URL, connectez-vous, « Ajouter à l'écran d'accueil ».

**Ne déployez jamais sans `DASHBOARD_PASSWORD`** : l'URL serait publique et votre
portefeuille visible par quiconque la trouve.

## Alertes de prix

L'icône cloche, en haut du tableau de bord, ouvre les réglages : activez les alertes,
choisissez l'heure de la vérification quotidienne, puis renseignez les seuils voulus
(laisser une case vide désactive cette alerte). Les six seuils sont indépendants :
hausse et baisse, par rapport au PRU, au dernier prix d'achat et au dernier prix de vente.

**Sans aucune configuration**, la fenêtre récapitulative s'ouvre à l'ouverture du
tableau de bord dès qu'au moins un seuil est franchi, en indiquant les titres
concernés, la situation et le pourcentage réel relevé.

Pour recevoir en plus une **notification push** quand l'app est fermée, il faut ajouter
quatre variables d'environnement et connecter une base — tout est gratuit.

### 1. Générer les clés VAPID

Sur votre ordinateur, dans le dossier du projet :

```
npm run vapid
```

Ça affiche trois lignes `NOM=valeur`. Gardez-les sous la main, vous allez les copier
dans Vercel à l'étape suivante. Ne les partagez jamais publiquement (ne les commitez
pas, ne les collez pas dans une issue GitHub) : `VAPID_PRIVATE_KEY` doit rester secrète.

### 2. Ajouter les variables dans Vercel

Sur [vercel.com](https://vercel.com), ouvrez votre projet, puis dans le **menu de
gauche** cliquez directement sur **Environment Variables** (pas besoin de passer par
Settings, le lien est dans le menu principal). Vous arrivez sur une page qui liste déjà
`SHEET_URL` et `DASHBOARD_PASSWORD` — les mêmes que vous avez ajoutées au premier
déploiement.

En haut à droite, cliquez sur le bouton **« Add Environment Variable »**. Une ligne
`Name` / `Value` apparaît : vous y ajoutez, une par une, quatre variables (nouveau clic
sur « Add Environment Variable » à chaque fois, ou une ligne supplémentaire s'ouvre
automatiquement selon la version de l'interface) :

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | la clé publique affichée par `npm run vapid` |
| `VAPID_PRIVATE_KEY` | la clé privée affichée par `npm run vapid` |
| `VAPID_SUBJECT` | `mailto:` suivi de votre email, ex. `mailto:vous@example.com` |
| `CRON_SECRET` | une chaîne inventée d'au moins 16 caractères, ex. `k7Xm2pQr9vNt4wZa` |

Pour chacune, cochez **Production** avant de valider (c'est ce qui indique à Vercel
que la variable s'applique à votre dashboard en ligne, pas seulement aux previews).

### 3. Connecter une base Redis

Toujours dans le menu de gauche, cliquez sur **Storage**, puis créez une base
**Redis** (offre Upstash gratuite) et connectez-la au projet. Vercel ajoute alors
lui-même les variables nécessaires (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) — il n'y a
rien à copier ni à taper pour celles-ci. C'est cette base qui permet à la vérification
programmée de retrouver, le lendemain, les appareils qui se sont abonnés la veille.

### 4. Redéployer et activer

Une fois les quatre variables et la base en place, redéployez (Vercel le propose
automatiquement après l'ajout d'une variable, sinon relancez un déploiement depuis
l'onglet **Deployments**). Ouvrez ensuite le dashboard, cliquez sur la cloche, et un
bouton **« Activer sur cet appareil »** apparaît dans le bloc « Notifications push » —
à cliquer sur chaque appareil voulu, téléphone et ordinateur s'abonnant séparément.

Détails utiles :

- Les notifications marchent sur Chrome, Edge et Firefox (Windows, macOS, Linux),
  sur Safari macOS 13+, sur Android, et sur iPhone **à condition que la PWA soit
  installée sur l'écran d'accueil** (iOS 16.4+). Sur ordinateur, le navigateur doit
  tourner, même fenêtre fermée ; sinon la notification est délivrée à son redémarrage.
- Une position qui reste au-dessus de son seuil **ne notifie qu'une fois** : seuls les
  seuils nouvellement franchis déclenchent un envoi. Un seuil qui cesse d'être franchi
  se réarme automatiquement.
- Le plan Vercel Hobby limite chaque expression cron à une exécution par jour, mais
  autorise 100 entrées : `vercel.json` en déclare donc une par heure UTC vers la même
  route, et le code décide si l'heure choisie est arrivée dans votre fuseau. L'heure
  est respectée à l'heure près (Vercel se réserve les 59 minutes suivantes).
- Le push ne transporte aucune donnée : il ne fait que réveiller le service worker,
  qui vient chercher lui-même les chiffres sur votre serveur. Les cours et les montants
  ne transitent jamais par les serveurs de notification de Google ou d'Apple.

## Recevoir les mises à jour

Quand le dépôt d'origine évolue, GitHub affiche sur votre fork un bouton
**« Sync fork »** : cliquez-le, Vercel redéploie automatiquement votre instance
avec la nouvelle version. C'est tout.

## Utilisation locale (optionnel)

```
cp .env.example .env    # puis renseigner SHEET_URL dans .env
npm start               # http://localhost:3457
```

Node >= 22 suffit, aucune installation de dépendances. Sans `DASHBOARD_PASSWORD`,
l'accès local est direct (pas de page de connexion). Le premier chargement prend
15-30 s (récupération des cours), ensuite tout est en cache dans `cache/`.

## Méthodologie des calculs

- **Positions / PRU** : méthode du coût moyen pondéré, rejouée sur tout l'historique.
  Les ventes portent des quantités négatives dans l'export ; `amount` est brut et
  `fee`/`tax` sont des colonnes séparées (cash = amount + fee + tax). Les splits,
  dividendes en actions et actions gratuites entrent à coût nul, ce qui ajuste le PRU
  naturellement. Les frais d'ordre ne sont pas inclus dans le PRU.
- **Comptes** : `account_type` sépare les comptes (DEFAULT = CTO, PEA…), et les
  cryptos (`asset_class = CRYPTO`) forment leur propre section même si elles vivent
  dans le compte titres. Un compte inconnu de ce code obtient quand même sa section,
  sous son nom brut. Les espèces sont suivies par compte ; les cryptos n'ont pas de
  poche d'espèces propre (elles sont achetées avec celle du compte titres), et les
  transferts internes entre comptes ne comptent pas comme des versements.
- **Cryptos** : cotées par ticker (`BTC`, `ETH`) et non par ISIN ; Yahoo les fournit
  directement en EUR (`BTC-EUR`), sans conversion de change, et elles cotent 24h/24
  (elles ne servent donc jamais de référence pour la séance des marchés actions).
- **Résidus** : une position dont il reste moins de 0,04 part est considérée soldée
  et passe en Archives. Pour les cryptos, divisibles à l'infini, le seuil descend à
  0,000001 unité — 0,04 bitcoin représenterait des milliers d'euros.
- **Performance du portefeuille** : Time-Weighted Return quotidien
  (`r = V_jour / (V_veille + flux du jour) − 1`, chaîné depuis le début de la période).
  Les dépôts/retraits et les achats/ventes ne déforment donc pas la courbe. Les
  dividendes en espèces comptent comme un flux sortant des positions.
- **Filtre de comptes et plage personnalisée** : sélectionner un ou plusieurs comptes
  recalcule la courbe (et ses flux) sur ce sous-ensemble uniquement, avec pour départ
  la première activité du compte le plus ancien retenu — jamais celle du portefeuille
  entier. Les boutons de période (1 S, 1 M…) n'apparaissent que si l'historique de la
  sélection remonte assez loin ; la plage personnalisée est bornée de la même façon
  (impossible de remonter avant le début d'activité du compte sélectionné).
- **Prix historiques réels** : Yahoo fournit des séries ajustées rétroactivement des
  splits/attributions. Comme le registre contient les quantités réellement détenues,
  les prix réels sont reconstruits en multipliant la série ajustée par les ratios des
  opérations sur titres du relevé (ex. un split 10:1). Garde-fou supplémentaire :
  la série est comparée aux prix des transactions elles-mêmes et rescalée si l'écart
  médian dépasse 4 % avec au moins 3 transactions concordantes (mauvaise classe de
  parts renvoyée par la recherche ISIN, split survenu après la clôture d'une position).
- **Prix des dernières opérations** : le prix du dernier achat / de la dernière vente
  est ramené à une action d'aujourd'hui quand une opération sur titre a eu lieu depuis
  (marqueur « ↺ » et prix d'origine en info-bulle), sinon la comparaison avec le cours
  actuel n'aurait aucun sens (ex. 567,90 € payés avant un split 10:1 = 56,79 € par
  action actuelle).
- **Actifs non cotés sur Yahoo** (warrants, certificats) : valorisés par interpolation
  linéaire entre les prix observés dans les transactions, badge « ≈ » dans l'interface.
- **La vue « 1 J »** agrège les barres 5 min de la dernière séance disponible ; si les
  marchés sont fermés, la dernière séance est affichée et datée.

## Limites connues

- Yahoo Finance ne cote pas certains produits dérivés (warrants Société Générale…) :
  ils sont valorisés au dernier prix de transaction connu.
- L'historique de cours remonte à 3 ans maximum.
- Sur Vercel, le cache est éphémère : après une période d'inactivité, le premier
  chargement refait les appels Yahoo (~15-30 s).
- Le Google Sheet doit rester partagé par lien pour être lisible par le serveur.

## Architecture

```
server.mjs        serveur local (Node pur, port 3457)
api/              fonctions serverless Vercel (mêmes routes que le serveur local)
lib/service.mjs   logique métier partagée (dashboard, séries de performance, logos)
lib/ledger.mjs    moteur de positions (rejeu de l'historique)
lib/portfolio.mjs valorisation EUR, TWR, séries intraday
lib/yahoo.mjs     résolution ISIN, cours, taux de change (cache disque)
lib/auth.mjs      mot de passe optionnel (cookie HMAC signé)
lib/alerts.mjs    règles de seuils (miroir de la table dans public/app.js)
lib/alerts-service.mjs  vérification quotidienne : heure locale, anti-doublon, envoi
lib/store.mjs     état des alertes (Redis REST, fichier local, ou mémoire)
lib/push.mjs      Web Push signé VAPID, sans dépendance (node:crypto)
public/sw.js      service worker : transforme un push en notification
public/           frontend vanilla (graphique SVG fait main, PWA)
```

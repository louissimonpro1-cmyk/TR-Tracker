# Installer TR Tracker, pas à pas

Guide pour installer votre propre instance de TR Tracker. Comptez 15 minutes.
Aucune compétence technique n'est nécessaire : **rien à installer sur votre
ordinateur**, tout se passe dans le navigateur.

Chaque personne installe **sa propre instance**, avec **son propre historique** et
**son propre mot de passe**. Personne ne voit le portefeuille de personne d'autre.

Pour les réglages avancés (notifications push, base Redis, usage local), voir le
[README](README.md).

---

## Ce qu'il vous faut

Trois comptes, tous gratuits, tous créés en 2 minutes :

| Compte | À quoi ça sert | Où le créer |
|---|---|---|
| Google | héberger votre historique de transactions | vous l'avez déjà si vous avez Gmail |
| GitHub | héberger votre copie du code | https://github.com/signup |
| Vercel | mettre votre dashboard en ligne | https://vercel.com/signup |

---

## Étape 1 : préparer votre historique Trade Republic

Le dashboard ne stocke rien. Il lit **en direct** un Google Sheet que vous
contrôlez. Il faut donc d'abord créer ce Sheet.

### 1.1 Exporter vos transactions

Dans l'app Trade Republic, exportez votre historique d'activité. Vous obtenez un
fichier avec ces colonnes :

```
datetime, date, account_type, category, type, asset_class, name, symbol,
shares, price, amount, fee, tax, currency, ...
```

### 1.2 Mettre le fichier dans Google Sheets

1. Ouvrez https://sheets.google.com
2. Cliquez sur **Vide** pour créer un nouveau tableur
3. Menu **Fichier → Importer → Importer**, choisissez votre fichier exporté
4. Vérifiez que la première ligne contient bien les noms de colonnes ci-dessus

### 1.3 Partager le Sheet en lecture seule

C'est l'étape la plus importante, et celle qu'on rate le plus souvent.

1. Bouton **Partager**, en haut à droite
2. Section « Accès général », cliquez sur **Lecteurs restreints**
3. Choisissez **« Tous les utilisateurs disposant du lien »**
4. Vérifiez que le rôle à droite est bien **Lecteur** (pas Éditeur)
5. Cliquez sur **Copier le lien**, puis **Terminé**

Gardez ce lien de côté, vous en aurez besoin à l'étape 3.

> **Ce lien est votre configuration.** Il n'est indexé nulle part, mais quiconque
> l'obtient peut lire vos transactions. Ne le publiez sur aucun forum, aucun chat
> public, aucune issue GitHub.

---

## Étape 2 : copier le code sur votre compte GitHub

1. Allez sur https://github.com/louissimonpro1-cmyk/TR-Tracker
2. Cliquez sur **Fork**, en haut à droite
3. Laissez tous les réglages par défaut, cliquez sur **Create fork**

Vous avez maintenant votre propre copie du code. C'est elle que Vercel va publier.

---

## Étape 3 : mettre en ligne avec Vercel

1. Allez sur https://vercel.com et connectez-vous **avec votre compte GitHub**
   (bouton « Continue with GitHub »). Choisissez le plan **Hobby**, gratuit.
2. Cliquez sur **Add New… → Project**
3. Dans la liste des dépôts, trouvez **TR-Tracker** et cliquez sur **Import**
4. Avant de déployer, dépliez la section **Environment Variables** et ajoutez ces
   deux lignes :

| Name | Value |
|---|---|
| `SHEET_URL` | le lien de partage copié à l'étape 1.3 |
| `DASHBOARD_PASSWORD` | un mot de passe de votre choix, que vous seul connaissez |

5. Cliquez sur **Deploy**, puis attendez une minute.

Vercel vous donne une adresse du type `https://tr-tracker-xxxx.vercel.app`.
C'est votre dashboard.

> **N'omettez jamais `DASHBOARD_PASSWORD`.** Sans lui, l'adresse est publique et
> votre portefeuille est lisible par quiconque tombe dessus.

---

## Étape 4 : première ouverture

1. Ouvrez votre adresse Vercel
2. Entrez le mot de passe choisi à l'étape 3
3. Le premier chargement prend **15 à 30 secondes** : le serveur va chercher tous
   les cours. Les suivants sont instantanés.

Vous devez voir :

- le graphique de performance de l'ensemble du portefeuille, en haut
- une section par compte (PEA, CTO, Cryptos), selon ce que contient votre historique
- une ligne par position, cliquable pour déplier son graphique et ses performances
- une section Archives avec les positions entièrement revendues

---

## Étape 5 : installer sur téléphone

1. Ouvrez votre adresse Vercel dans le navigateur du téléphone
2. Connectez-vous
3. **iPhone** : bouton Partager, puis « Sur l'écran d'accueil »
   **Android** : menu à trois points, puis « Ajouter à l'écran d'accueil »

L'icône TR Tracker apparaît comme une vraie application.

---

## Étape 6 (optionnel) : les alertes de prix

L'icône **cloche** en haut du dashboard ouvre les réglages. Vous y définissez
jusqu'à six seuils indépendants (hausse et baisse, par rapport au PRU, au dernier
achat et à la dernière vente) et l'heure de la vérification quotidienne.

**Sans aucune configuration supplémentaire**, un récapitulatif s'ouvre à
l'ouverture du dashboard dès qu'un seuil est franchi.

Pour recevoir en plus une **notification push** quand l'app est fermée, il faut
quatre variables d'environnement et une base Redis gratuite. La procédure complète
est dans le [README, section « Alertes de prix »](README.md#alertes-de-prix).

---

## Étape 7 : garder à jour

**Vos transactions** : ajoutez les nouvelles lignes dans votre Google Sheet. Le
dashboard les lit en direct, il n'y a rien d'autre à faire.

**Le code** : quand le dépôt d'origine évolue, GitHub affiche un bouton
**« Sync fork »** sur votre copie. Cliquez dessus, Vercel redéploie tout seul.

---

## Problèmes courants

**« Le dashboard est vide, aucune position »**
Le Sheet n'est probablement pas lisible. Reprenez l'étape 1.3 : l'accès général
doit être « Tous les utilisateurs disposant du lien », pas « Restreint ».

**« Ça me demande un mot de passe que je n'ai pas défini »**
Le mot de passe est celui que vous avez tapé dans `DASHBOARD_PASSWORD` sur Vercel.
Pour le changer : projet Vercel → **Environment Variables** → modifiez la valeur →
onglet **Deployments** → **Redeploy**.

**« J'ai ajouté des transactions, elles n'apparaissent pas »**
Les cours sont mis en cache environ 30 minutes. Attendez, ou forcez le
rafraîchissement de la page (Ctrl+Maj+R, ou Cmd+Maj+R sur Mac).

**« Une période de performance est grisée »**
C'est volontaire. Si l'historique du titre ne couvre pas la période, elle reste
vide plutôt que d'afficher un chiffre calculé sur une durée plus courte.

---

## Pour aller plus loin : faire tourner l'app sur votre ordinateur

Facultatif, et réservé à ceux que ça amuse. Il faut
[Node.js](https://nodejs.org) version 22 ou plus.

```bash
git clone https://github.com/VOTRE-COMPTE/TR-Tracker.git
```

Puis, dans le dossier obtenu, copiez `.env.example` en `.env`, renseignez-y
`SHEET_URL`, et lancez :

```bash
npm start
```

Le dashboard répond sur http://localhost:3457. Il n'y a **aucune dépendance à
installer** : le projet n'utilise que Node lui-même. Sans `DASHBOARD_PASSWORD`
dans le `.env`, l'accès local se fait sans page de connexion.

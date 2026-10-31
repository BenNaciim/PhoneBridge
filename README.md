<p align="center">
  <img src="pc/assets/icon.png" alt="PhoneBridge" width="128" height="128">
</p>

<h1 align="center">PhoneBridge</h1>

<p align="center">
  <a href="https://github.com/BenNaciim/PhoneBridge/actions/workflows/release.yml"><img src="https://github.com/BenNaciim/PhoneBridge/actions/workflows/release.yml/badge.svg" alt="Release workflow"></a>
  <a href="https://github.com/BenNaciim/PhoneBridge/releases/latest"><img src="https://img.shields.io/github/v/release/BenNaciim/PhoneBridge?label=release" alt="Latest release"></a>
</p>

<p align="center">
  🇫🇷 <a href="#-français">Français</a> · 🇬🇧 <a href="#-english">English</a>
</p>

---

# 🇫🇷 Français

**PhoneBridge affiche sur votre PC Windows les notifications, les SMS/MMS et les appels de votre téléphone Android, et vous permet d'y répondre depuis le clavier.**

Pas de compte Microsoft, pas de cloud, pas de serveur externe : le téléphone et le PC se parlent directement, sur le même Wi-Fi, avec une connexion chiffrée.

## Fonctions

- **Messages** : lecture et envoi de SMS, réception et envoi de photos (MMS, bouton trombone), réponse depuis le PC.
- **Photos et vidéos reçues** : affichées dans la conversation (clic sur une photo pour l'agrandir, lecteur pour les vidéos de 6 Mo au plus) pour les MMS et, quand l'application en laisse l'accès, pour WhatsApp, Messenger…
- **Recherche et nouvelle conversation** : barre de recherche (Ctrl+K) dans les noms, numéros et messages ; bouton « + » (Ctrl+N) pour écrire à un contact du téléphone ou à un numéro.
- **Messageries** : les conversations WhatsApp, Messenger, Telegram… apparaissent dans la liste des messages, avec SMS, regroupées par contact, pastille de l'application et filtres. Réponse depuis le PC via la notification.
- **Notifications** : toutes celles du téléphone, avec l'icône de l'application, réponse directe quand l'application la propose.
- **Effacer d'un geste** : glissez deux doigts sur le pavé tactile pour effacer une notification, ici et sur le téléphone.
- **Appels** : historique, appels en absence avec pastille et alerte.
- **Alertes sur le bureau** : une carte en bas de l'écran avec un champ de réponse rapide.
- **Réglages** : thème clair, sombre ou automatique, transparence et flou du verre, choix des applications dont on veut les notifications, démarrage avec Windows.
- **Reconnexion automatique** : retour du Wi-Fi, redémarrage du téléphone, changement d'adresse du PC.
- **Mises à jour** : le PC détecte les nouvelles releases GitHub, vérifie la somme SHA-256 de l'installateur, puis s'installe et redémarre en un clic.
- **Chiffré** : TLS avec épinglage du certificat, le code de jumelage fait foi.

## Installation

1. Téléchargez les deux fichiers depuis la [dernière release](https://github.com/BenNaciim/PhoneBridge/releases/latest) :
   - `PhoneBridge-Setup-x.y.z.exe` pour le PC (Windows 10 ou 11, installation en un clic, sans droits administrateur) ;
   - `PhoneBridge.apk` pour le téléphone (Android 8 ou plus).
2. Lancez l'installateur. PhoneBridge démarre avec Windows et reste dans la zone de notification.
   Windows peut afficher un avertissement (le fichier n'est pas signé) : « Informations complémentaires », puis « Exécuter quand même ».
3. Installez l'APK (autorisez l'installation depuis cette source) et ouvrez PhoneBridge.
4. Activez les lignes de **Autorisations**, puis touchez **Scanner le QR code** et scannez celui de la fenêtre PC.

> **Android 13 et plus** : pour une application installée à la main, l'envoi de SMS est bloqué par défaut.
> Ouvrez *Infos sur l'application → ⋮ → Autoriser les paramètres restreints*, puis accordez l'autorisation SMS.

## Comment ça marche

```
┌────────────────────┐   Wi-Fi local, TLS (wss)    ┌────────────────────┐
│ Téléphone Android  │ ──────────────────────────▶ │  PC Windows        │
│ app Kotlin         │   notifications, SMS/MMS,   │  app Electron      │
│ (service au        │   appels                    │  (serveur WebSocket│
│  premier plan)     │ ◀────────────────────────── │   + interface)     │
└────────────────────┘   réponses, effacements     └────────────────────┘
```

- Le PC génère un certificat auto-signé et affiche un QR code qui contient son adresse, un code secret et l'empreinte du certificat.
- Le téléphone n'accepte que le certificat dont l'empreinte correspond : un autre appareil sur le même Wi-Fi est refusé.
- Le PC s'annonce sur le réseau (mDNS) : si son adresse change, le téléphone le retrouve seul.

## Sécurité et vie privée

- Aucune donnée ne quitte votre réseau local. Rien n'est envoyé à un serveur tiers.
- Le code de jumelage donne accès à vos messages : ne le partagez pas. Cinq essais ratés bloquent l'adresse une minute.
- Les messages ne sont pas conservés sur le PC : ils sont relus depuis le téléphone à chaque connexion. Seuls les réglages, les icônes d'applications et le certificat sont enregistrés.

## Limites connues

- Les SMS envoyés depuis le PC partent bien, mais Android ne les range dans « Envoyés » que si PhoneBridge est l'application SMS par défaut.
- MMS : une photo à la fois, réduite à ≈ 300 Ko ; l'envoi demande les données mobiles et des réglages MMS valides chez l'opérateur. Pas d'envoi de photos par WhatsApp, Messenger… Appels : affichage seul, pas de rappel depuis le PC.
- Messageries : seuls les messages passés par une notification sont visibles (pas d'historique plus ancien ; les photos et vidéos seulement si l'application laisse PhoneBridge y accéder, sinon une simple mention « Photo »), conservés en mémoire tant que l'application est ouverte. On ne peut répondre que tant que la notification existe sur le téléphone.
- Le téléphone et le PC doivent être sur le même réseau local.
- Certains téléphones coupent les applications en arrière-plan : activez « Rester actif en arrière-plan » dans l'application.
- L'installateur n'est pas signé (avertissement SmartScreen).

## Développement

```bash
# Application PC (Node 20 ou plus)
cd pc
npm install
npm start                      # lance l'application
node tools/fake-phone.js CODE  # simule un téléphone (CODE = code de jumelage affiché)
npm run dist                   # construit l'installateur dans pc/dist

# Application Android (JDK 17 à 21, Android SDK 36)
cd android
./gradlew assembleDebug        # APK dans app/build/outputs/apk/debug
```

Pour régénérer l'icône : `cd pc && npm run icon` (écrit le PNG du PC et l'icône Android).

### Publier une version

L'intégration continue (`.github/workflows/release.yml`) construit l'installateur Windows et l'APK, puis les publie dans une release GitHub :

```bash
git tag v1.0.0
git push origin v1.0.0
```

Le lancement manuel du workflow (onglet *Actions*) construit les fichiers sans publier : ils sont téléchargeables dans les artefacts du run.

### Structure

| Dossier | Contenu |
| --- | --- |
| `pc/` | Application Windows : Electron, serveur WebSocket TLS, interface, alertes, installateur |
| `android/` | Application Android : service de relais, lecture des notifications, SMS/MMS, appels |
| `.github/workflows/` | Intégration continue et publication |

---

# 🇬🇧 English

**PhoneBridge shows your Android phone's notifications, SMS/MMS and calls on your Windows PC, and lets you reply from the keyboard.**

No Microsoft account, no cloud, no external server: the phone and the PC talk directly over your local Wi-Fi, through an encrypted connection.

## Features

- **Messages**: read and send SMS, receive and send photos (MMS, paperclip button), reply from the PC.
- **Received photos and videos**: shown in the conversation (click a photo to enlarge it, player for videos up to 6 MB) for MMS and, when the app allows access, for WhatsApp, Messenger…
- **Search and new conversation**: search bar (Ctrl+K) across names, numbers and messages; "+" button (Ctrl+N) to write to a phone contact or any number.
- **Messaging apps**: WhatsApp, Messenger, Telegram… conversations show up in the message list next to SMS, grouped per contact, with an app badge and filters. Reply from the PC through the notification.
- **Notifications**: everything your phone shows, with the app's icon, and direct replies when the app supports them.
- **Swipe to dismiss**: swipe two fingers on the touchpad to clear a notification, on the PC and on the phone.
- **Calls**: call history, missed calls with a badge and an alert.
- **Desktop alerts**: a card at the bottom of the screen with a quick-reply field.
- **Settings**: light, dark or automatic theme, glass transparency and blur, per-app notification filter, start with Windows.
- **Automatic reconnection**: Wi-Fi back, phone reboot, PC address change.
- **Updates**: the PC detects new GitHub releases, checks the installer's SHA-256, then installs and restarts in one click.
- **Encrypted**: TLS with certificate pinning, the pairing code is the source of trust.

## Installation

1. Download both files from the [latest release](https://github.com/BenNaciim/PhoneBridge/releases/latest):
   - `PhoneBridge-Setup-x.y.z.exe` for the PC (Windows 10 or 11, one-click install, no admin rights needed);
   - `PhoneBridge.apk` for the phone (Android 8 or later).
2. Run the installer. PhoneBridge starts with Windows and lives in the system tray.
   Windows may show a warning because the file is unsigned: "More info", then "Run anyway".
3. Install the APK (allow installs from this source) and open PhoneBridge.
4. Turn on each line under **Permissions**, then tap **Scan the QR code** and scan the one shown by the PC app.

> **Android 13 and later**: for a sideloaded app, sending SMS is blocked by default.
> Open *App info → ⋮ → Allow restricted settings*, then grant the SMS permission.

## How it works

```
┌────────────────────┐   Local Wi-Fi, TLS (wss)    ┌────────────────────┐
│ Android phone      │ ──────────────────────────▶ │  Windows PC        │
│ Kotlin app         │   notifications, SMS/MMS,   │  Electron app      │
│ (foreground        │   calls                     │  (WebSocket server │
│  service)          │ ◀────────────────────────── │   + interface)     │
└────────────────────┘   replies, dismissals       └────────────────────┘
```

- The PC generates a self-signed certificate and shows a QR code containing its address, a secret code and the certificate fingerprint.
- The phone only accepts the certificate matching that fingerprint: any other device on the same Wi-Fi is rejected.
- The PC announces itself on the network (mDNS): if its address changes, the phone finds it again on its own.

## Security and privacy

- No data leaves your local network. Nothing is sent to a third-party server.
- The pairing code gives access to your messages: do not share it. Five failed attempts block the address for one minute.
- Messages are not stored on the PC: they are read again from the phone on each connection. Only settings, app icons and the certificate are saved.

## Known limitations

- SMS sent from the PC are delivered, but Android only files them under "Sent" if PhoneBridge is the default SMS app.
- MMS: one photo at a time, shrunk to about 300 KB; sending needs mobile data and valid carrier MMS settings. No photo sending through WhatsApp, Messenger… Calls are display-only, with no call-back from the PC.
- Messaging apps: only messages that came through a notification are visible (no older history; photos and videos only if the app lets PhoneBridge read them, otherwise just a "Photo" mention), kept in memory while the app is open. You can reply only while the notification still exists on the phone.
- The phone and the PC must be on the same local network.
- Some phones kill background apps: turn on "Stay active in the background" in the app.
- The installer is unsigned (SmartScreen warning).

## Development

```bash
# PC app (Node 20 or later)
cd pc
npm install
npm start                      # run the app
node tools/fake-phone.js CODE  # simulate a phone (CODE = pairing code shown by the app)
npm run dist                   # build the installer into pc/dist

# Android app (JDK 17 to 21, Android SDK 36)
cd android
./gradlew assembleDebug        # APK in app/build/outputs/apk/debug
```

To regenerate the icon: `cd pc && npm run icon` (writes the PC PNG and the Android icon).

### Releasing

Continuous integration (`.github/workflows/release.yml`) builds the Windows installer and the APK, then publishes them in a GitHub release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Running the workflow manually (*Actions* tab) builds the files without publishing: download them from the run's artifacts.

### Layout

| Folder | Contents |
| --- | --- |
| `pc/` | Windows app: Electron, TLS WebSocket server, interface, alerts, installer |
| `android/` | Android app: relay service, notification listener, SMS/MMS, calls |
| `.github/workflows/` | Continuous integration and release |
